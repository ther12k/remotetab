import { describe, expect, it } from 'vitest';
import { newSessionId } from './ids.ts';
import {
  acceptControlFrame,
  CONTROL_MESSAGE_TYPES,
  ControlSender,
  controlMessageSchema,
  decodeControlFrame,
  encodeControlFrame,
  MAX_CONTROL_FRAME_BYTES,
  MAX_TEXT_LENGTH,
  MODIFIER,
  ProtocolError,
  parseControlMessage,
  SequenceGuard,
  viewportSyncSchema,
} from './index.ts';

const SESSION = newSessionId();

function baseFrame(
  overrides: Record<string, unknown> = {},
  payload: Record<string, unknown> = { x: 0.5, y: 0.5 },
) {
  return {
    v: 1,
    sessionId: SESSION,
    seq: 1,
    ts: Date.now(),
    type: 'pointer.move',
    payload,
    ...overrides,
  };
}

describe('control envelope', () => {
  it('accepts a well-formed frame', () => {
    const r = parseControlMessage(baseFrame());
    expect(r.ok).toBe(true);
  });

  it('rejects unknown protocol versions', () => {
    const r = parseControlMessage(baseFrame({ v: 2 }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('MESSAGE_INVALID');
  });

  it('rejects unknown message types', () => {
    const r = parseControlMessage(
      baseFrame({ type: 'cdp.command' }, { method: 'Runtime.evaluate', params: {} }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.code).toBe('MESSAGE_INVALID');
  });

  it('rejects unknown payload keys (strict objects)', () => {
    const r = parseControlMessage(baseFrame({}, { x: 0.5, y: 0.5, evil: true }));
    expect(r.ok).toBe(false);
  });

  it('rejects wrong session shape and non-monotonic ts', () => {
    expect(parseControlMessage(baseFrame({ sessionId: 'short' })).ok).toBe(false);
    expect(parseControlMessage(baseFrame({ ts: -5 })).ok).toBe(false);
  });
});

describe('coordinate validation', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['too large', 1.0000001],
    ['negative', -0.01],
  ])('rejects %s coordinate', (_label, value) => {
    expect(parseControlMessage(baseFrame({}, { x: value, y: 0.5 })).ok).toBe(false);
  });

  it('accepts 0 and 1 as coordinates', () => {
    expect(parseControlMessage(baseFrame({}, { x: 0, y: 1 })).ok).toBe(true);
  });
});

describe('text.insert bounds', () => {
  it('accepts text at the limit', () => {
    const r = parseControlMessage({
      ...baseFrame({ type: 'text.insert' }, { text: 'a' }),
      payload: { text: 'a'.repeat(MAX_TEXT_LENGTH) },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects text beyond the limit', () => {
    const r = parseControlMessage(
      baseFrame({ type: 'text.insert' }, { text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects empty text and unpaired surrogates', () => {
    expect(parseControlMessage(baseFrame({ type: 'text.insert' }, { text: '' })).ok).toBe(false);
    expect(parseControlMessage(baseFrame({ type: 'text.insert' }, { text: '\ud800' })).ok).toBe(
      false,
    );
    expect(parseControlMessage(baseFrame({ type: 'text.insert' }, { text: '\udc00' })).ok).toBe(
      false,
    );
    expect(parseControlMessage(baseFrame({ type: 'text.insert' }, { text: '👍' })).ok).toBe(true);
  });
});

describe('key events', () => {
  it('accepts standard keys with modifiers', () => {
    const r = parseControlMessage(
      baseFrame(
        { type: 'key.down' },
        { key: 'a', code: 'KeyA', modifiers: MODIFIER.CTRL | MODIFIER.SHIFT },
      ),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects out-of-range modifiers and multiline key text', () => {
    expect(
      parseControlMessage(
        baseFrame({ type: 'key.down' }, { key: 'a', code: 'KeyA', modifiers: 99 }),
      ).ok,
    ).toBe(false);
    expect(
      parseControlMessage(
        baseFrame({ type: 'key.down' }, { key: 'a\nb', code: 'KeyA', modifiers: 0 }),
      ).ok,
    ).toBe(false);
    expect(
      parseControlMessage(
        baseFrame({ type: 'key.down' }, { key: 'Enter', code: 'not a code!', modifiers: 0 }),
      ).ok,
    ).toBe(false);
  });

  it('rejects non-finite wheel deltas and oversized deltas', () => {
    expect(
      parseControlMessage(
        baseFrame({ type: 'wheel' }, { x: 0.5, y: 0.5, deltaX: 0, deltaY: Number.NaN }),
      ).ok,
    ).toBe(false);
    expect(
      parseControlMessage(
        baseFrame({ type: 'wheel' }, { x: 0.5, y: 0.5, deltaX: 0, deltaY: 20000 }),
      ).ok,
    ).toBe(false);
  });

  it('rejects invalid buttons and click counts', () => {
    expect(
      parseControlMessage(
        baseFrame({ type: 'pointer.down' }, { x: 0.1, y: 0.1, button: 'middle', clickCount: 4 }),
      ).ok,
    ).toBe(false);
    expect(
      parseControlMessage(
        baseFrame({ type: 'pointer.down' }, { x: 0.1, y: 0.1, button: 'super', clickCount: 1 }),
      ).ok,
    ).toBe(false);
  });
});

describe('sequence guard', () => {
  it('accepts strictly increasing sequences', () => {
    const g = new SequenceGuard();
    expect(g.check(1).ok).toBe(true);
    expect(g.check(2).ok).toBe(true);
    expect(g.check(3).ok).toBe(true);
  });

  it('detects duplicates and rollbacks', () => {
    const g = new SequenceGuard();
    for (let i = 1; i <= 5; i++) g.check(i);
    const dup = g.check(5);
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.error.code).toBe('REPLAY_REJECTED');
    const rollback = g.check(2);
    expect(rollback.ok === false && rollback.error.code).toBe('REPLAY_REJECTED');
  });

  it('rejects gaps on a reliable ordered channel', () => {
    const g = new SequenceGuard();
    g.check(1);
    const gap = g.check(4);
    expect(gap.ok === false && gap.error.code).toBe('MESSAGE_INVALID');
  });

  it('rejects non-integer and zero seq', () => {
    const g = new SequenceGuard();
    expect(g.check(0).ok).toBe(false);
    expect(g.check(1.5).ok).toBe(false);
  });
});

describe('acceptControlFrame', () => {
  it('rejects frames from a different session', () => {
    const g = new SequenceGuard();
    const sender = new ControlSender(newSessionId());
    const raw = sender.pointerMove(0.5, 0.5);
    const r = acceptControlFrame(raw, g, SESSION);
    expect(r.ok === false && r.error.code).toBe('MESSAGE_INVALID');
  });

  it('enforces the sequence guard', () => {
    const g = new SequenceGuard();
    const sender = new ControlSender(SESSION);
    acceptControlFrame(sender.pointerMove(0.1, 0.1), g, SESSION);
    const dup = acceptControlFrame(sender.pointerMove(0.2, 0.2), g, SESSION);
    // sender produced seq=2; replaying seq=1 must fail
    const replay = acceptControlFrame(
      JSON.stringify({
        v: 1,
        sessionId: SESSION,
        seq: 1,
        ts: Date.now(),
        type: 'pointer.move',
        payload: { x: 0.3, y: 0.3 },
      }),
      g,
      SESSION,
    );
    expect(dup.ok).toBe(true);
    expect(replay.ok === false && replay.error.code).toBe('REPLAY_REJECTED');
  });
});

describe('ControlSender round-trip', () => {
  it('produces decodable frames with incrementing seq', () => {
    const sender = new ControlSender(SESSION);
    const g = new SequenceGuard();
    const frames = [
      sender.pointerMove(0.25, 0.75),
      sender.pointerDown(0.25, 0.75),
      sender.pointerUp(0.25, 0.75),
      sender.wheel(0.5, 0.5, 0, -382),
      sender.keyDown('Enter', 'Enter'),
      sender.keyUp('Enter', 'Enter'),
      sender.insertText('hello 👍'),
      sender.viewportRequest(),
      sender.sessionStop('user'),
    ];
    for (const [i, raw] of frames.entries()) {
      const r = acceptControlFrame(raw, g, SESSION);
      expect(r.ok).toBe(true);
      expect(r.ok === true && r.value.seq).toBe(i + 1);
    }
  });

  it('throws MESSAGE_TOO_LARGE on oversized encodes', () => {
    const sender = new ControlSender(SESSION);
    expect(() => sender.insertText('a'.repeat(MAX_TEXT_LENGTH + 1))).toThrow(ProtocolError);
  });

  it('keeps serialized frames under the control size bound', () => {
    const sender = new ControlSender(SESSION);
    const raw = sender.insertText('x'.repeat(MAX_TEXT_LENGTH));
    expect(new TextEncoder().encode(raw).length).toBeLessThan(MAX_CONTROL_FRAME_BYTES);
  });
});

describe('misc schemas', () => {
  it('validates viewport.sync', () => {
    expect(
      viewportSyncSchema.safeParse({ cssWidth: 1440, cssHeight: 900, deviceScaleFactor: 2 })
        .success,
    ).toBe(true);
    expect(
      viewportSyncSchema.safeParse({ cssWidth: 0, cssHeight: 900, deviceScaleFactor: 2 }).success,
    ).toBe(false);
    expect(
      viewportSyncSchema.safeParse({
        cssWidth: 1440,
        cssHeight: 900,
        deviceScaleFactor: Number.NaN,
      }).success,
    ).toBe(false);
    expect(viewportSyncSchema.safeParse({ cssWidth: 1440, cssHeight: 900 }).success).toBe(false);
  });

  it('covers all documented control types', () => {
    expect([...CONTROL_MESSAGE_TYPES].sort()).toEqual(
      [
        'pointer.move',
        'pointer.down',
        'pointer.up',
        'wheel',
        'key.down',
        'key.up',
        'text.insert',
        'viewport.request',
        'viewport.sync',
        'session.stop',
      ].sort(),
    );
    // Negative guarantee: no generic CDP escape hatch exists in the union.
    expect(CONTROL_MESSAGE_TYPES).not.toContain('cdp');
    expect(CONTROL_MESSAGE_TYPES).not.toContain('cdp.command');
  });

  it('exposes no generic CDP passthrough shape', () => {
    const r = controlMessageSchema.safeParse({
      v: 1,
      sessionId: SESSION,
      seq: 1,
      ts: Date.now(),
      type: 'cdp',
      payload: { method: 'Runtime.evaluate', params: {} },
    });
    expect(r.success).toBe(false);
  });
});

describe('decode/encode size guards', () => {
  it('rejects oversized frames before JSON parsing', () => {
    const huge = `{"pad":"${'a'.repeat(MAX_CONTROL_FRAME_BYTES)}"}`;
    const r = decodeControlFrame(huge);
    expect(r.ok === false && r.error.code).toBe('MESSAGE_TOO_LARGE');
  });

  it('rejects invalid JSON', () => {
    const r = decodeControlFrame('{not json');
    expect(r.ok === false && r.error.code).toBe('MESSAGE_INVALID');
  });

  it('encodeControlFrame returns JSON strings', () => {
    const raw = encodeControlFrame({
      v: 1,
      sessionId: SESSION,
      seq: 1,
      ts: Date.now(),
      type: 'pointer.move',
      payload: { x: 0.5, y: 0.5 },
    });
    expect(typeof raw).toBe('string');
    expect(decodeControlFrame(raw).ok).toBe(true);
  });
});
