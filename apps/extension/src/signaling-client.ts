/**
 * Signaling WebSocket client used by the service worker. Auto-reconnects
 * with capped exponential backoff while Remote Mode is active, sends
 * presence pings, and treats the server as untrusted: inbound frames are
 * schema-validated before dispatch.
 */

import {
  decodeSignalingFrame,
  helloSchema,
  presencePingSchema,
  type SignalingMessage,
  signalingFrame,
} from '@remotetab/protocol';
import { BackoffPolicy } from './backoff.ts';

export type SignalingState = 'offline' | 'connecting' | 'online';

export type SignalingClientOptions = {
  url: string;
  hello: { role: 'desktop' | 'phone'; deviceId: string; displayName?: string };
  /** Heartbeat interval (ms) — must be smaller than the server's stale window. */
  pingIntervalMs?: number;
  /** Close the socket when no inbound frame arrives for this long (ms). */
  pongTimeoutMs?: number;
  onFrame: (frame: SignalingMessage) => void;
  onState: (state: SignalingState) => void;
  /** Injectable for tests. */
  socketFactory?: (url: string) => WebSocket;
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

  constructor(private readonly opts: SignalingClientOptions) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 15_000;
    this.pongTimeoutMs = opts.pongTimeoutMs ?? 45_000;
    this.timers = opts.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
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
      this.lastInboundMs = Date.now();
      const hello = helloSchema.parse(this.opts.hello);
      socket.send(JSON.stringify(signalingFrame('hello', hello)));
      this.setState('online');
      this.startPings();
    };
    socket.onmessage = (ev) => {
      this.lastInboundMs = Date.now();
      const frame = decodeSignalingFrame(String(ev.data));
      if (!frame.ok) {
        // The server sent something the protocol rejects — treat as hostile
        // and re-establish.
        socket.close(1002, 'protocol');
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
    this.pingHandle = this.timers.set(() => {
      const pongOverdue = Date.now() - this.lastInboundMs > this.pongTimeoutMs;
      if (pongOverdue) {
        this.socket?.close(4000, 'stale');
        return;
      }
      this.send(signalingFrame('presence.ping', presencePingSchema.parse({ ts: Date.now() })));
    }, this.pingIntervalMs);
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
    this.stopSockets();
    this.socket?.close(1000, 'client-stop');
    this.socket = null;
    this.setState('offline');
  }
}
