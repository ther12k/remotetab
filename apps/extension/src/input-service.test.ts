import type { ControlMessage } from '@remotetab/protocol';
import { ControlSender } from '@remotetab/protocol';
import { describe, expect, it } from 'vitest';
import type { RemoteInputAdapter, Viewport } from './input-adapter.ts';
import { InputService } from './input-service.ts';

const SESSION = 'sess_testsession00000000001';

function makeFakeAdapter() {
  const calls: { op: string; arg?: unknown }[] = [];
  let attached = false;
  const adapter: RemoteInputAdapter = {
    async attach(tabId: number) {
      calls.push({ op: 'attach', arg: tabId });
      attached = true;
    },
    async detach() {
      calls.push({ op: 'detach' });
      attached = false;
    },
    get isAttached() {
      return attached;
    },
    async getViewport(): Promise<Viewport> {
      calls.push({ op: 'getViewport' });
      return { width: 1440, height: 900, deviceScaleFactor: 2 };
    },
    async pointerMove(input) {
      calls.push({ op: 'pointer.move', arg: input });
    },
    async pointerDown(input) {
      calls.push({ op: 'pointer.down', arg: input });
    },
    async pointerUp(input) {
      calls.push({ op: 'pointer.up', arg: input });
    },
    async wheel(input) {
      calls.push({ op: 'wheel', arg: input });
    },
    async keyDown(input) {
      calls.push({ op: 'key.down', arg: input });
    },
    async keyUp(input) {
      calls.push({ op: 'key.up', arg: input });
    },
    async insertText(text) {
      calls.push({ op: 'text.insert', arg: text });
    },
  };
  return { adapter, calls };
}

function makeSender() {
  const sender = new ControlSender(SESSION);
  const sent: string[] = [];
  return {
    frame(build: (s: ControlSender) => string): string {
      const raw = build(sender);
      sent.push(raw);
      return raw;
    },
    sent,
    raw(build: (s: ControlSender) => string): string {
      return build(sender);
    },
  };
}

async function makeService() {
  const { adapter, calls } = makeFakeAdapter();
  const outbox: string[] = [];
  const service = new InputService(adapter, {
    send(raw: string): boolean {
      outbox.push(raw);
      return true;
    },
  });
  await service.start(SESSION, 42);
  return { service, calls, outbox };
}

describe('InputService gating', () => {
  it('attaches, syncs the viewport, and dispatches valid input', async () => {
    const { service, calls, outbox } = await makeService();
    const mine = makeSender();
    const raw = mine.raw((s) => s.pointerMove(0.5, 0.5));
    const result = await service.handleFrame(SESSION, raw, 'remote-active', 42);
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.op === 'attach' && c.arg === 42)).toBe(true);
    expect(calls.some((c) => c.op === 'pointer.move')).toBe(true);
    // viewport.sync was pushed on start
    expect(outbox.some((r) => r.includes('viewport.sync'))).toBe(true);
  });

  it('rejects input before remote-active (fail closed)', async () => {
    const { service } = await makeService();
    const mine = makeSender();
    const raw = mine.raw((s) => s.pointerDown(0.1, 0.1));
    const result = await service.handleFrame(SESSION, raw, 'peer-connected', 42);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INPUT_NOT_ATTACHED');
  });

  it('rejects frames from a different session', async () => {
    const { service } = await makeService();
    const other = new ControlSender('sess_otherticket0000000001');
    const raw = other.pointerMove(0.5, 0.5);
    const result = await service.handleFrame(SESSION, raw, 'remote-active', 42);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate/replayed sequences and tears down', async () => {
    const { service } = await makeService();
    const mine = makeSender();
    // First frame is seq 1 for a NEW sender each time — replaying the same
    // serialized frame must fail on the duplicate seq.
    const raw = mine.raw((s) => s.keyDown('a', 'KeyA'));
    expect((await service.handleFrame(SESSION, raw, 'remote-active', 42)).ok).toBe(true);
    const replay = await service.handleFrame(SESSION, raw, 'remote-active', 42);
    expect(replay.ok).toBe(false);
    expect(replay.ok === false && replay.code).toBe('REPLAY_REJECTED');
  });

  it('rejects when the target tab is gone', async () => {
    const { service } = await makeService();
    const mine = makeSender();
    const raw = mine.raw((s) => s.keyDown('Enter', 'Enter'));
    const result = await service.handleFrame(SESSION, raw, 'remote-active', null);
    expect(result.ok === false && result.code).toBe('TARGET_TAB_CLOSED');
  });

  it('stop detaches and disarms', async () => {
    const { service, calls } = await makeService();
    await service.stop();
    expect(calls[calls.length - 1]?.op).toBe('detach');
    expect(service.armed).toBe(false);
    const mine = makeSender();
    const raw = mine.raw((s) => s.pointerMove(0.1, 0.1));
    const result = await service.handleFrame(SESSION, raw, 'remote-active', 42);
    expect(result.ok).toBe(false);
  });

  it('dispatches wheel, text, key up/down through the narrow adapter', async () => {
    const { service, calls } = await makeService();
    const mine = makeSender();
    await service.handleFrame(
      SESSION,
      mine.raw((s) => s.wheel(0.5, 0.5, 0, -382)),
      'remote-active',
      42,
    );
    await service.handleFrame(
      SESSION,
      mine.raw((s) => s.insertText('hello')),
      'remote-active',
      42,
    );
    await service.handleFrame(
      SESSION,
      mine.raw((s) => s.keyDown('Enter', 'Enter')),
      'remote-active',
      42,
    );
    await service.handleFrame(
      SESSION,
      mine.raw((s) => s.keyUp('Enter', 'Enter')),
      'remote-active',
      42,
    );
    const ops = calls.map((c) => c.op);
    expect(ops).toContain('wheel');
    expect(ops).toContain('text.insert');
    expect(ops).toContain('key.down');
    expect(ops).toContain('key.up');
  });

  it('viewport.request responds with a viewport.sync frame', async () => {
    const { service, outbox } = await makeService();
    outbox.length = 0;
    const mine = makeSender();
    await service.handleFrame(
      SESSION,
      mine.raw((s) => s.viewportRequest()),
      'remote-active',
      42,
    );
    expect(outbox).toHaveLength(1);
    const parsed = JSON.parse(outbox[0] ?? '{}') as ControlMessage;
    expect(parsed.type).toBe('viewport.sync');
    expect(parsed.payload).toEqual({ cssWidth: 1440, cssHeight: 900, deviceScaleFactor: 2 });
  });
});

describe('no generic CDP surface', () => {
  it('RemoteInputAdapter exposes no sendCommand method', async () => {
    const { adapter } = makeFakeAdapter();
    const record = adapter as unknown as Record<string, unknown>;
    expect('sendCommand' in record).toBe(false);
    expect('send' in record).toBe(false);
    expect('cdp' in record).toBe(false);
  });
});
