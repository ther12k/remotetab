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
  encodeControlFrame,
  ProtocolError,
  SequenceGuard,
} from '@remotetab/protocol';
import type { RemoteInputAdapter } from '@/input-adapter.ts';

export type InputDispatchResult =
  | { ok: true; action: string }
  | { ok: false; code: string; message: string };

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
  ) {}

  /** Arm input for a session: attach the debugger and sync the viewport. */
  async start(sessionId: string, tabId: number): Promise<void> {
    await this.stop();
    this.guard = new SequenceGuard();
    this.sessionId = sessionId;
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
    if (!this.armed || this.sessionId !== sessionId || this.guard === null) {
      return {
        ok: false,
        code: 'INPUT_NOT_ATTACHED',
        message: 'Remote input is not attached to this session.',
      };
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
