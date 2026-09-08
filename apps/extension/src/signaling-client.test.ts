/**
 * SignalingClient lifecycle (audit issue #26): the heartbeat must repeat for
 * as long as the connection lives, and close() must actually close the
 * underlying WebSocket instead of only dropping the reference.
 */

import type { SignalingMessage } from '@remotetab/protocol';
import { describe, expect, it } from 'vitest';
import { SignalingClient, type SignalingState } from './signaling-client.ts';

type FakeTimer = { fn: () => void; at: number };

function makeClock() {
  let now = 0;
  let timers: FakeTimer[] = [];
  const advance = (ms: number): void => {
    now += ms;
    for (const t of timers.splice(0)) t.fn();
  };
  const api = {
    advance,
    timers: {
      set(fn: () => void, ms: number): unknown {
        const t: FakeTimer = { fn, at: now + ms };
        timers.push(t);
        return t;
      },
      clear(handle: unknown): void {
        timers = timers.filter((t) => t !== handle);
      },
    },
  };
  return { api, now: () => now };
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  closedWith: { code: number; reason: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    void url;
    FakeSocket.instances.push(this);
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { code: code ?? 0, reason: reason ?? '' };
  }
  openEvent(): void {
    this.onopen?.();
  }
}

function makeClient(clock: ReturnType<typeof makeClock>, states: SignalingState[]) {
  return new SignalingClient({
    url: 'ws://signaling.test/ws',
    hello: { role: 'desktop', deviceId: 'dev_laptop000001' },
    onFrame: () => {},
    onState: (s) => states.push(s),
    timers: clock.api.timers,
    nowMs: clock.now,
    socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
}

describe('SignalingClient heartbeat (#26)', () => {
  it('sends a presence ping on EVERY interval, not just once', () => {
    FakeSocket.instances = [];
    const clock = makeClock();
    const client = makeClient(clock, []);
    client.connect();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('no socket');
    socket.openEvent();

    clock.api.advance(15_000);
    clock.api.advance(15_000);
    clock.api.advance(15_000);

    const pings = socket.sent
      .map((raw) => JSON.parse(raw) as SignalingMessage)
      .filter((f) => f.type === 'presence.ping');
    expect(pings).toHaveLength(3);
    client.close();
  });

  it('closes the socket when no inbound frame arrives within the pong window', () => {
    FakeSocket.instances = [];
    const clock = makeClock();
    const client = makeClient(clock, []);
    client.connect();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('no socket');
    socket.openEvent();

    clock.api.advance(15_000); // ping 1, inbound silence begins
    clock.api.advance(15_000); // ping 2 (30s < 45s, still tolerated)
    clock.api.advance(15_000); // 45s: not yet strictly past the deadline
    expect(socket.closedWith).toBeNull();
    clock.api.advance(15_000); // 60s silent → stale, close 4000
    expect(socket.closedWith?.code).toBe(4000);
    client.close();
  });

  it('keeps pinging while frames flow, and recovers after a reconnect', () => {
    FakeSocket.instances = [];
    const clock = makeClock();
    const client = makeClient(clock, []);
    client.connect();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('no socket');
    socket.openEvent();
    clock.api.advance(15_000);
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: 'presence.pong',
        payload: { ts: 1 },
        id: 'req_test00000001',
      }),
    });
    clock.api.advance(15_000);
    clock.api.advance(15_000);
    const pings = socket.sent.filter((raw) => raw.includes('presence.ping'));
    expect(pings.length).toBe(3); // fresh inbound keeps the socket alive
    client.close();
  });
});

describe('SignalingClient.close (#26)', () => {
  it('closes the underlying socket with a proper close frame', () => {
    FakeSocket.instances = [];
    const clock = makeClock();
    const client = makeClient(clock, []);
    client.connect();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('no socket');
    socket.openEvent();
    expect(socket.closedWith).toBeNull();
    client.close();
    expect(socket.closedWith?.code).toBe(1000);
    expect(socket.closedWith?.reason).toBe('client-stop');
  });

  it('does not reconnect after close even if the socket fires onclose', () => {
    FakeSocket.instances = [];
    const clock = makeClock();
    const states: SignalingState[] = [];
    const client = makeClient(clock, states);
    client.connect();
    const first = FakeSocket.instances[0];
    if (!first) throw new Error('no socket');
    first.openEvent();
    client.close();
    // A late onclose must not schedule another connection.
    first.onclose?.();
    clock.api.advance(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.current()).toBe('offline');
  });
});
