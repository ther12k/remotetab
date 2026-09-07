/**
 * Input service: the single authority that decides whether a control frame
 * from the phone may act on the tab (issue #009, gated by #014 later).
 *
 * Pipeline for every frame:
 *   1. schema validation (offscreen already did; the SW re-checks);
 *   2. session id must match the ACTIVE session;
 *   3. sequence guard (monotonic, per session);
 *   4. session phase must be remote-active (fail closed otherwise);
 *   5. narrow adapter dispatch — no other behavior exists.
 */

import {
  acceptControlFrame,
  type ControlMessage,
  type ControlPayload,
  encodeControlFrame,
  ProtocolError,
  SequenceGuard,
} from '@remotetab/protocol';
import type { RemoteInputAdapter } from '@/input-adapter.ts';

export type InputDispatchResult =
  | { ok: true; action: string }
  | { ok: false; code: string; message: string };

export type PeerAuthDelegate = (
  message: ControlMessage,
) => Promise<'verified' | 'failed' | 'pending' | null>;

export interface ControlSender {
  /** Deliver a control frame to the phone; false when the channel is down. */
  send(raw: string): boolean;
}

export class InputService {
  private guard: SequenceGuard | null = null;
  private sessionId: string | null = null;
  private attached = false;

  constructor(
    private readonly adapter: RemoteInputAdapter,
    private readonly sender: ControlSender,
    private readonly onPeerAuth?: PeerAuthDelegate,
  ) {}

  /** Arm the session guard WITHOUT touching the debugger (pre-auth). */
  begin(sessionId: string): void {
    this.guard = new SequenceGuard();
    this.sessionId = sessionId;
    this.attached = false;
  }

  /** Full arm for an authenticated session: attach debugger + sync viewport. */
  async start(sessionId: string, tabId: number): Promise<void> {
    await this.stop();
    this.begin(sessionId);
    await this.attachTo(tabId);
  }

  /** Attach the debugger and push viewport.sync (called after peer proof). */
  async attachTo(tabId: number): Promise<void> {
    await this.adapter.attach(tabId);
    this.attached = true;
    await this.syncViewport();
  }

  /** Disarm; safe to call any number of times. */
  async stop(): Promise<void> {
    if (this.attached) {
      await this.adapter.detach();
      this.attached = false;
    }
    this.guard = null;
    this.sessionId = null;
  }

  get armed(): boolean {
    return this.attached && this.sessionId !== null;
  }

  /** Laptop→phone frames use their own sequence space (schema-clean). */
  private laptopSeq = 0;

  /**
   * Build ANY laptop→phone control frame (viewport.sync, peer.*) with the
   * shared monotonic laptop sequence. Peer handlers use this so auth frames
   * and viewport frames stay ordered for the phone's sequence guard.
   */
  buildLaptopFrame<T extends 'viewport.sync' | 'peer.challenge' | 'peer.proof'>(
    type: T,
    payload: ControlPayload<T>,
  ): string {
    this.laptopSeq += 1;
    return encodeControlFrame({
      v: 1,
      sessionId: this.sessionId ?? '',
      seq: this.laptopSeq,
      ts: Date.now(),
      type,
      payload,
    } as ControlMessage);
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  private async syncViewport(): Promise<void> {
    const viewport = await this.adapter.getViewport();
    this.laptopSeq += 1;
    this.sender.send(
      encodeControlFrame({
        v: 1,
        sessionId: this.sessionId ?? '',
        seq: this.laptopSeq,
        ts: Date.now(),
        type: 'viewport.sync',
        payload: {
          cssWidth: viewport.width,
          cssHeight: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
        },
      }),
    );
  }

  /** Handle one schema-validated control frame. */
  async handleFrame(
    sessionId: string,
    raw: string,
    phase: string,
    targetTabId: number | null,
  ): Promise<InputDispatchResult> {
    if (this.sessionId !== sessionId || this.guard === null) {
      return {
        ok: false,
        code: 'INPUT_NOT_ATTACHED',
        message: 'Remote input is not attached to this session.',
      };
    }

    // Envelope + seq + session — strict, replay-safe.
    let message: ControlMessage;
    try {
      const parsed = acceptControlFrame(raw, this.guard, sessionId);
      if (!parsed.ok) {
        throw parsed.error;
      }
      message = parsed.value;
    } catch (err) {
      const code = err instanceof ProtocolError ? err.code : 'MESSAGE_INVALID';
      const message2 =
        code === 'REPLAY_REJECTED'
          ? 'Input frames were rejected as replayed.'
          : 'Input frame failed validation.';
      return { ok: false, code, message: message2 };
    }

    // Peer-auth frames bypass input gating: they ARE the gate (#014).
    if (message.type === 'peer.challenge' || message.type === 'peer.proof') {
      const outcome = (await this.onPeerAuth?.(message)) ?? 'failed';
      return { ok: true, action: `peer.${outcome}` };
    }

    if (phase !== 'remote-active') {
      return {
        ok: false,
        code: 'INPUT_NOT_ATTACHED',
        message: 'Remote input is paused until the session is active.',
      };
    }
    if (targetTabId === null) {
      return { ok: false, code: 'TARGET_TAB_CLOSED', message: 'The remote tab is gone.' };
    }
    if (!this.attached) {
      return {
        ok: false,
        code: 'INPUT_NOT_ATTACHED',
        message: 'Remote input lost its debugger attachment.',
      };
    }

    try {
      switch (message.type) {
        case 'pointer.move':
          await this.adapter.pointerMove(message.payload);
          return { ok: true, action: 'pointer.move' };
        case 'pointer.down':
          await this.adapter.pointerDown(message.payload);
          return { ok: true, action: 'pointer.down' };
        case 'pointer.up':
          await this.adapter.pointerUp(message.payload);
          return { ok: true, action: 'pointer.up' };
        case 'wheel':
          await this.adapter.wheel(message.payload);
          return { ok: true, action: 'wheel' };
        case 'key.down':
          await this.adapter.keyDown(message.payload);
          return { ok: true, action: 'key.down' };
        case 'key.up':
          await this.adapter.keyUp(message.payload);
          return { ok: true, action: 'key.up' };
        case 'text.insert':
          await this.adapter.insertText(message.payload.text);
          return { ok: true, action: 'text.insert' };
        case 'viewport.request':
          await this.syncViewport();
          return { ok: true, action: 'viewport.request' };
        case 'session.stop':
          return { ok: true, action: 'session.stop' };
      }
    } catch (err) {
      const raw0 = err instanceof Error ? err.message : '';
      if (raw0.startsWith('INPUT_NOT_ATTACHED')) {
        // The debugger was detached under us — fail closed for this frame.
        return {
          ok: false,
          code: 'INPUT_NOT_ATTACHED',
          message: 'Remote input lost its debugger attachment.',
        };
      }
      return {
        ok: false,
        code: 'MESSAGE_INVALID',
        message: 'The remote input could not be delivered.',
      };
    }
    return { ok: false, code: 'MESSAGE_INVALID', message: 'Unsupported input type.' };
  }
}
