/**
 * Signaling WebSocket client used by the service worker. Auto-reconnects
 * with capped exponential backoff while Remote Mode is active, sends
 * presence pings, and treats the server as untrusted: inbound frames are
 * schema-validated before dispatch.
 */

import {
  authChallengeSchema,
  authProofSchema,
  decodeSignalingFrame,
  helloSchema,
  presencePingSchema,
  type SignalingMessage,
  signalingFrame,
} from '@remotetab/protocol';
import { BackoffPolicy } from './backoff.ts';

export type SignalingState = 'offline' | 'connecting' | 'online';

export type SignalingAuth = {
  deviceId: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  displayName?: string;
  /** Sign the server's nonce challenge with the device key → base64url. */
  sign(nonce: string): Promise<string>;
};

export type SignalingClientOptions = {
  url: string;
  hello: { role: 'desktop' | 'phone'; deviceId: string; displayName?: string };
  /** Present to answer auth.challenge (issue #018). */
  auth?: SignalingAuth;
  /** Heartbeat interval (ms) — must be smaller than the server's stale window. */
  pingIntervalMs?: number;
  /** Close the socket when no inbound frame arrives for this long (ms). */
  pongTimeoutMs?: number;
  onFrame: (frame: SignalingMessage) => void;
  onState: (state: SignalingState) => void;
  /** Injectable for tests. */
  socketFactory?: (url: string) => WebSocket;
  /** Injectable clock for tests (pong deadline math). */
  nowMs?: () => number;
  timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
};

export class SignalingClient {
  private socket: WebSocket | null = null;
  private state: SignalingState = 'offline';
  private pingHandle: unknown = null;
  private pongDeadlineHandle: unknown = null;
  private reconnectHandle: unknown = null;
  private lastInboundMs = 0;
  private stopped = true;
  private readonly backoff = new BackoffPolicy(500, 8_000);

  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly timers: NonNullable<SignalingClientOptions['timers']>;
  private readonly nowMs: () => number;

  constructor(private readonly opts: SignalingClientOptions) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 15_000;
    this.pongTimeoutMs = opts.pongTimeoutMs ?? 45_000;
    this.timers = opts.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.nowMs = opts.nowMs ?? Date.now;
  }

  current(): SignalingState {
    return this.state;
  }

  private setState(next: SignalingState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onState(next);
  }

  connect(): void {
    if (!this.stopped && this.socket) return;
    this.stopped = false;
    this.open();
  }

  private open(): void {
    this.setState('connecting');
    const socket = this.opts.socketFactory
      ? this.opts.socketFactory(this.opts.url)
      : new WebSocket(this.opts.url);
    this.socket = socket;
    socket.onopen = () => {
      this.backoff.reset();
      this.lastInboundMs = this.nowMs();
      const hello = helloSchema.parse(this.opts.hello);
      socket.send(JSON.stringify(signalingFrame('hello', hello)));
      this.setState('online');
      this.startPings();
    };
    socket.onmessage = (ev) => {
      this.lastInboundMs = this.nowMs();
      const frame = decodeSignalingFrame(String(ev.data));
      if (!frame.ok) {
        // The server sent something the protocol rejects — treat as hostile
        // and re-establish.
        socket.close(1002, 'protocol');
        return;
      }
      if (frame.value.type === 'auth.challenge') {
        void this.answerChallenge(frame.value.payload.nonce);
        return;
      }
      if (frame.value.type === 'auth.ok') {
        return;
      }
      this.opts.onFrame(frame.value);
    };
    socket.onclose = () => {
      this.stopSockets();
      if (this.stopped) {
        this.setState('offline');
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose follows; nothing else to do here.
    };
  }

  private startPings(): void {
    this.stopPings();
    // Self-rescheduling chain (#26): one ping per interval for as long as the
    // socket lives — the server evicts connections silent for 45s.
    const schedule = (): void => {
      this.pingHandle = this.timers.set(() => {
        const pongOverdue = this.nowMs() - this.lastInboundMs > this.pongTimeoutMs;
        if (pongOverdue) {
          this.pingHandle = null;
          this.socket?.close(4000, 'stale');
          return;
        }
        this.send(signalingFrame('presence.ping', presencePingSchema.parse({ ts: Date.now() })));
        schedule();
      }, this.pingIntervalMs);
    };
    schedule();
  }

  private stopPings(): void {
    if (this.pingHandle !== null) {
      this.timers.clear(this.pingHandle);
      this.pingHandle = null;
    }
  }

  private scheduleReconnect(): void {
    this.setState('offline');
    const delay = this.backoff.next();
    this.reconnectHandle = this.timers.set(() => {
      this.reconnectHandle = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private stopSockets(): void {
    this.stopPings();
    if (this.pongDeadlineHandle !== null) {
      this.timers.clear(this.pongDeadlineHandle);
      this.pongDeadlineHandle = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
  }

  private async answerChallenge(nonce: string): Promise<void> {
    const auth = this.opts.auth;
    if (!auth || this.socket === null) return;
    try {
      authChallengeSchema.parse({ nonce });
      const signature = await auth.sign(nonce);
      const proof = authProofSchema.parse({
        signature,
        publicKeySpki: auth.publicKeySpki,
        publicKeyFingerprint: auth.publicKeyFingerprint,
        displayName: auth.displayName ?? undefined,
      });
      this.socket.send(JSON.stringify(signalingFrame('auth.proof', proof)));
    } catch {
      // A malformed proof cannot help us; required-mode servers will close.
    }
  }

  /** Send a frame; false when currently offline. */
  send(frame: SignalingMessage): boolean {
    if (this.state !== 'online' || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  /** Permanent close: no further reconnects. */
  close(): void {
    this.stopped = true;
    if (this.reconnectHandle !== null) {
      this.timers.clear(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    this.backoff.reset();
    // Capture the socket BEFORE stopSockets() detaches it (#26) so the
    // underlying WebSocket actually gets a close frame.
    const socket = this.socket;
    this.stopSockets();
    socket?.close(1000, 'client-stop');
    this.setState('offline');
  }
}
