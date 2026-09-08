// @vitest-environment jsdom
/**
 * Cross-layer sequence continuity (audit issue #22). The laptop applies ONE
 * strict monotonic guard to every phone frame — peer-auth and user input
 * alike. These tests drive a real ReceiverSession (mocked WebRTC transport)
 * through peer auth + touch + keyboard and assert a single, gapless,
 * strictly increasing sequence across the WHOLE session.
 */

import { decodeControlFrame } from '@remotetab/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrioritizedInputSender } from './input-sender.ts';
import { KeyboardBridge } from './keyboard-bridge.ts';
import { ReceiverSession } from './receiver-session.ts';
import { TouchBridge } from './touch-bridge.ts';

const h = vi.hoisted(() => {
  const sentFrames: string[] = [];
  class FakePeerHandle {
    static instances: FakePeerHandle[] = [];
    private handlers = new Map<string, ((p: unknown) => void)[]>();
    pc = {};
    closed = false;
    constructor() {
      FakePeerHandle.instances.push(this);
    }
    on(event: string, fn: (p: unknown) => void): () => void {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return () => {
        this.handlers.set(
          event,
          (this.handlers.get(event) ?? []).filter((f) => f !== fn),
        );
      };
    }
    emit(event: string, payload: unknown): void {
      for (const fn of this.handlers.get(event) ?? []) fn(payload);
    }
    sendControl(raw: string): boolean {
      sentFrames.push(raw);
      return true;
    }
    close(): void {
      this.closed = true;
    }
  }
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    static instances = sockets;
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = FakeWebSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closeCalls: { code?: number; reason?: string }[] = [];
    constructor(_url: string) {
      FakeWebSocket.instances.push(this);
    }
    send(_raw: string): void {}
    close(code?: number, reason?: string): void {
      this.readyState = 3;
      this.closeCalls.push({ code, reason });
    }
  }
  return { sentFrames, FakePeerHandle, FakeWebSocket, sockets };
});

vi.mock('@remotetab/webrtc', () => ({
  RTCPeerHandle: h.FakePeerHandle,
  describeSelectedPair: async () => null,
}));

const DESKTOP_ID = 'dev_desktop000001';
const PHONE_ID = 'dev_phone0000001';
const SESSION_ID = 'sess_test00000001';

function acceptedFrame(): string {
  return JSON.stringify({
    v: 1,
    id: 'req_test00000001',
    type: 'session.accepted',
    payload: {
      sessionId: SESSION_ID,
      desktopDeviceId: DESKTOP_ID,
      phoneDeviceId: PHONE_ID,
    },
  });
}

/** A ReceiverSession driven to the `signaling` phase with a fake peer. */
function makeLiveSession(): ReceiverSession {
  const session = new ReceiverSession({
    url: 'ws://signaling.test/ws',
    desktopDeviceId: DESKTOP_ID,
    identity: { deviceId: PHONE_ID, displayName: 'Test phone' },
    iceServers: [],
  });
  session.connect();
  const socket = h.sockets[h.sockets.length - 1];
  if (!socket) throw new Error('no socket');
  socket.onopen?.();
  socket.onmessage?.({ data: acceptedFrame() });
  return session;
}

/** Video + element pair whose rectangle maps clientX/Y 1:1 into [0,1]. */
function makeVideoSurface(): { wrap: HTMLElement; video: HTMLVideoElement } {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: 1000 });
  Object.defineProperty(video, 'videoHeight', { value: 500 });
  video.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 500,
      height: 250,
      top: 0,
      left: 0,
      right: 500,
      bottom: 250,
      toJSON: () => ({}),
    }) as DOMRect;
  const wrap = document.createElement('div');
  wrap.getBoundingClientRect = video.getBoundingClientRect;
  return { wrap, video };
}

function seqs(): number[] {
  return h.sentFrames.map((raw) => {
    const parsed = decodeControlFrame(raw);
    if (!parsed.ok) throw new Error(`invalid frame sent: ${raw}`);
    return parsed.value.seq;
  });
}

describe('phone→laptop sequence space (one owner)', () => {
  beforeEach(() => {
    h.sentFrames.length = 0;
    h.sockets.length = 0;
    h.FakePeerHandle.instances.length = 0;
    vi.stubGlobal('WebSocket', h.FakeWebSocket);
    localStorage.clear();
  });

  it('peer-auth + tap + text + keys share one gapless sequence (#22)', async () => {
    const session = makeLiveSession();
    expect(session.sessionId).toBe(SESSION_ID);

    // Peer-auth frames flow through the session's persistent sender.
    session.sendControlFrame((s) => s.peerChallenge('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
    session.sendControlFrame((s) =>
      s.peerProof({
        deviceId: PHONE_ID,
        publicKeyFingerprint: 'AAAAAAAAAAAAAAAAAAAAAA',
        signature: 'AAAAAAAAAAAAAAAAAAAAAA',
      }),
    );

    // A tap through the real touch bridge.
    const { wrap, video } = makeVideoSurface();
    const touch = new TouchBridge({ element: wrap, video, session });
    touch.setChannelOpen(true);
    const detach = touch.attach();
    wrap.dispatchEvent(
      Object.assign(new Event('pointerdown'), { clientX: 250, clientY: 125, pointerId: 1 }),
    );
    wrap.dispatchEvent(
      Object.assign(new Event('pointerup'), { clientX: 250, clientY: 125, pointerId: 1 }),
    );
    detach();

    // Text + control key through the keyboard bridge.
    const keyboard = new KeyboardBridge({
      session,
      sender: new PrioritizedInputSender({
        send: (raw) => session.sendControl(raw),
        encodeWheel: () => '',
      }),
    });
    keyboard.sendText('hello');
    keyboard.sendKey({ key: 'Enter', code: 'Enter', modifiers: 0 });

    const all = seqs();
    expect(h.sentFrames).toHaveLength(7);
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7]); // challenge, proof, down, up, text, keyDown, keyUp
    for (const raw of h.sentFrames) {
      const parsed = decodeControlFrame(raw);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.sessionId).toBe(SESSION_ID);
    }
  });

  it('two taps in a row never reuse a sequence number (old bug: seq 1,1)', async () => {
    const session = makeLiveSession();
    const { wrap, video } = makeVideoSurface();
    const touch = new TouchBridge({ element: wrap, video, session });
    touch.setChannelOpen(true);
    const detach = touch.attach();
    for (const _tap of [100, 200]) {
      wrap.dispatchEvent(
        Object.assign(new Event('pointerdown'), { clientX: 250, clientY: 125, pointerId: 1 }),
      );
      wrap.dispatchEvent(
        Object.assign(new Event('pointerup'), { clientX: 250, clientY: 125, pointerId: 1 }),
      );
    }
    detach();
    const all = seqs();
    expect(all).toEqual([1, 2, 3, 4]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('a queued move does not burn a sequence number out of send order', async () => {
    const session = makeLiveSession();
    const { wrap, video } = makeVideoSurface();
    const sender = new PrioritizedInputSender({
      send: (raw) => session.sendControl(raw),
      encodeWheel: () => '',
      moveIntervalMs: 30,
    });
    const touch = new TouchBridge({ element: wrap, video, session, sender });
    touch.setChannelOpen(true);
    const detach = touch.attach();
    // Drag (move queued, flushes later) then an immediate tap.
    wrap.dispatchEvent(
      Object.assign(new Event('pointerdown'), { clientX: 100, clientY: 100, pointerId: 1 }),
    );
    wrap.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: 250, clientY: 125, pointerId: 1 }),
    );
    wrap.dispatchEvent(
      Object.assign(new Event('pointerup'), { clientX: 250, clientY: 125, pointerId: 1 }),
    );
    detach();
    // Move flush timer fires after the tap frames were already sent; the
    // sequence must still be strictly increasing in SEND order.
    await new Promise((r) => setTimeout(r, 40));
    const all = seqs();
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const cur = all[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur).toBeGreaterThan(prev);
    }
    sender.dispose();
  });

  it('encoders return "" before a session exists (no sender, no seq)', () => {
    const session = new ReceiverSession({
      url: 'ws://signaling.test/ws',
      desktopDeviceId: DESKTOP_ID,
      identity: { deviceId: PHONE_ID, displayName: 'Test phone' },
      iceServers: [],
    });
    expect(session.encodePointerDown(0.5, 0.5)).toBe('');
    expect(session.encodeInsertText('x')).toBe('');
    const sender = new PrioritizedInputSender({
      send: (raw) => session.sendControl(raw),
      encodeWheel: () => '',
    });
    sender.sendUrgent(() => session.encodeInsertText('ignored'));
    sender.sendMove(() => session.encodePointerMove(0.5, 0.5));
    sender.flushNow();
    expect(h.sentFrames).toEqual([]);
    sender.dispose();
  });
});

describe('peer-failure recovery (#27)', () => {
  beforeEach(() => {
    h.sentFrames.length = 0;
    h.sockets.length = 0;
    h.FakePeerHandle.instances.length = 0;
    vi.stubGlobal('WebSocket', h.FakeWebSocket);
    localStorage.clear();
  });

  it('a failed peer connection recycles the whole session, not just the status', async () => {
    const session = makeLiveSession();
    const statuses: string[] = [];
    session.on('status', (s) => statuses.push(s.phase));
    const peer = h.FakePeerHandle.instances.at(-1);
    if (!peer) throw new Error('no peer');
    const socket = h.sockets.at(-1);
    if (!socket) throw new Error('no socket');

    peer.emit('connectionstate', 'failed');

    // Peer discarded, status flipped, and the signaling socket asked to close.
    expect(session.currentPhase).toBe('reconnecting');
    expect(peer.closed).toBe(true);
    expect(socket.closeCalls.some((c) => c.code === 4000)).toBe(true);

    // A real browser fires onclose after close(); that must schedule a fresh
    // session (new signaling socket with a hello), not stall in reconnecting.
    socket.onclose?.();
    await new Promise((r) => setTimeout(r, 1600));
    expect(h.sockets.length).toBe(2);
    expect(session.currentPhase).toBe('connecting');
    expect(statuses).toContain('reconnecting');
  });

  it('peer failure with an already-dead signaling socket still schedules a fresh session', async () => {
    const session = makeLiveSession();
    const peer = h.FakePeerHandle.instances.at(-1);
    if (!peer) throw new Error('no peer');
    const socket = h.sockets.at(-1);
    if (!socket) throw new Error('no socket');
    socket.readyState = 3; // signaling died without firing onclose

    peer.emit('connectionstate', 'failed');
    // handleSocketLost is driven directly; a new session is still scheduled.
    await new Promise((r) => setTimeout(r, 1600));
    expect(h.sockets.length).toBe(2);
    expect(session.currentPhase).toBe('connecting');
  });
});
