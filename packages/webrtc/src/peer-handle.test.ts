import { describe, expect, it, vi } from 'vitest';
import { type PeerDeps, RTCPeerHandle } from './peer-handle.ts';

/**
 * Minimal RTCPeerConnection / RTCDataChannel stubs so the handle's wiring,
 * eventing, and cleanup logic can be tested without a browser.
 */

type ChannelSpec = {
  label: string;
  readyState?: RTCDataChannelState;
  bufferedAmount?: number;
};

type ChanListeners = Record<string, ((ev?: unknown) => void)[]>;

function makeChannel(spec: ChannelSpec) {
  const listeners: ChanListeners = {};
  const fire = (name: string, ev?: unknown) => {
    for (const cb of listeners[name] ?? []) cb(ev);
  };
  const channel = {
    label: spec.label,
    binaryType: 'binary',
    readyState: (spec.readyState ?? 'open') as RTCDataChannelState,
    bufferedAmount: spec.bufferedAmount ?? 0,
    sent: [] as string[],
    addEventListener(name: string, cb: (ev?: unknown) => void) {
      const list = listeners[name] ?? [];
      list.push(cb);
      listeners[name] = list;
    },
    removeEventListener() {},
    close() {
      channel.readyState = 'closed';
    },
    send(text: string) {
      channel.sent.push(text);
    },
    fire,
  };
  return channel;
}

function makePC() {
  const channels: ReturnType<typeof makeChannel>[] = [];
  const pc = {
    connectionState: 'new' as RTCPeerConnectionState,
    iceServers: [] as RTCIceServer[],
    onicecandidate: null as ((ev: unknown) => void) | null,
    onconnectionstatechange: null as ((ev: unknown) => void) | null,
    ontrack: null as ((ev: unknown) => void) | null,
    ondatachannel: null as ((ev: unknown) => void) | null,
    localDescription: null as { toJSON: () => unknown } | null,
    createDataChannel(label: string) {
      const ch = makeChannel({ label, readyState: 'connecting' });
      channels.push(ch);
      return ch;
    },
    addTrack() {},
    close() {
      pc.connectionState = 'closed';
    },
    setLocalDescription: vi.fn(async (desc?: unknown) => {
      pc.localDescription = { toJSON: () => desc };
    }),
    setRemoteDescription: vi.fn(async () => {}),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'v=0' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'v=0' })),
    addIceCandidate: vi.fn(async () => {}),
    __channels: channels,
  };
  return pc;
}

function depsWith(pc: ReturnType<typeof makePC>): PeerDeps {
  return { createPeerConnection: () => pc as unknown as RTCPeerConnection };
}

describe('RTCPeerHandle (sender)', () => {
  it('creates control.v1 and health.v1 channels on the sender', () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('sender', { deps: depsWith(pc) });
    expect(pc.__channels.map((c) => c.label)).toEqual(['control.v1', 'health.v1']);
    handle.close();
  });

  it('forwards ice candidates and connection state', () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('sender', { deps: depsWith(pc) });
    const candidates: (RTCIceCandidateInit | null)[] = [];
    handle.on('icecandidate', (c) => candidates.push(c));
    pc.onicecandidate?.({
      candidate: {
        candidate: 'candidate:x',
        sdpMid: '0',
        sdpMLineIndex: 0,
        toJSON: () => ({ candidate: 'candidate:x', sdpMid: '0', sdpMLineIndex: 0 }),
      },
    });
    expect(candidates).toHaveLength(1);
    const states: string[] = [];
    handle.on('connectionstate', (s) => states.push(s));
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.(null);
    expect(states).toEqual(['connected']);
    handle.close();
  });

  it('sends on control only when open and under buffer limits', () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('sender', { deps: depsWith(pc) });
    const control = pc.__channels[0];
    if (!control) throw new Error('missing control channel');
    expect(handle.sendControl('x')).toBe(false); // still connecting
    control.readyState = 'open';
    expect(handle.sendControl('{"ok":1}')).toBe(true);
    expect(control.sent).toEqual(['{"ok":1}']);
    control.bufferedAmount = 2_000_000;
    expect(handle.sendControl('dropped')).toBe(false);
    handle.close();
    expect(handle.sendControl('after close')).toBe(false);
  });

  it('close is idempotent and detaches listeners', () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('sender', { deps: depsWith(pc) });
    handle.close();
    const states: string[] = [];
    handle.on('connectionstate', (s) => states.push(s));
    handle.close(); // second call is a no-op
    expect(states).toEqual([]);
    expect(pc.connectionState).toBe('closed');
  });
});

describe('RTCPeerHandle (receiver)', () => {
  it('binds channels arriving via ondatachannel by label', () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('receiver', { deps: depsWith(pc) });
    expect(handle.control).toBeNull();
    const ev = { channel: makeChannel({ label: 'control.v1', readyState: 'open' }) };
    pc.ondatachannel?.(ev);
    expect(handle.control?.label).toBe('control.v1');

    const messages: string[] = [];
    handle.on('control-message', (m) => messages.push(m));
    handle.control?.onmessage?.({ data: 'hello' } as unknown as MessageEvent);
    expect(messages).toEqual(['hello']);
    // Non-string payloads are ignored (protocol is text-only).
    handle.control?.onmessage?.({ data: new ArrayBuffer(2) } as unknown as MessageEvent);
    expect(messages).toEqual(['hello']);
  });

  it('accepts an offer and produces an answer', async () => {
    const pc = makePC();
    const handle = new RTCPeerHandle('receiver', { deps: depsWith(pc) });
    const answer = await handle.acceptOffer({ type: 'offer', sdp: 'v=0-offer' });
    expect(answer.type).toBe('answer');
    expect(pc.setRemoteDescription).toHaveBeenCalled();
  });
});
