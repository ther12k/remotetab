import { z } from 'zod';
import {
  decodeJsonFrame,
  envelopeBase,
  type ParseResult,
  parseWith,
  type SequenceGuard,
  unitCoord,
} from './frame.ts';
import { MAX_CONTROL_FRAME_BYTES, MAX_TEXT_LENGTH, MAX_WHEEL_DELTA, MODIFIER } from './limits.ts';
import { ProtocolError } from './protocol-error.ts';

/**
 * Control-channel messages (`control.v1`): everything the phone sends to the
 * laptop after peer authentication. Shapes are fixed here; behavior maps to
 * narrowly typed adapters only. There is deliberately NO generic CDP type.
 */

const mouseButton = z.enum(['left', 'right', 'middle']);
const modifiers = z
  .number()
  .int()
  .min(MODIFIER.NONE)
  .max(MODIFIER.CTRL | MODIFIER.ALT | MODIFIER.SHIFT | MODIFIER.META);

/** key/code strings are short identifiers, never free text. */
const keyName = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\x20-\x7E]+$/, 'key must be printable ASCII');
const keyCode = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/, 'code must be an identifier');

export const pointerMoveSchema = z.strictObject({ x: unitCoord, y: unitCoord });

export const pointerButtonSchema = z.strictObject({
  x: unitCoord,
  y: unitCoord,
  button: mouseButton,
  clickCount: z.number().int().min(1).max(3),
});

export const wheelSchema = z.strictObject({
  x: unitCoord,
  y: unitCoord,
  deltaX: z.number().int().finite().min(-MAX_WHEEL_DELTA).max(MAX_WHEEL_DELTA),
  deltaY: z.number().int().finite().min(-MAX_WHEEL_DELTA).max(MAX_WHEEL_DELTA),
});

export const keyEventSchema = z.strictObject({
  key: keyName,
  code: keyCode,
  modifiers,
});

/** Well-formed UTF-16: no unpaired surrogates (protects the CDP text path). */
const wellFormedText = z
  .string()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine((s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        if (i + 1 >= s.length) return false;
        const d = s.charCodeAt(++i);
        if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return false;
      }
    }
    return true;
  }, 'text contains unpaired surrogates');

export const textInsertSchema = z.strictObject({ text: wellFormedText });

export const viewportRequestSchema = z.strictObject({});

export const viewportSyncSchema = z.strictObject({
  cssWidth: z.number().int().finite().min(50).max(20000),
  cssHeight: z.number().int().finite().min(50).max(20000),
  deviceScaleFactor: z.number().finite().min(0.1).max(10),
});

export const sessionStopReason = z.enum([
  'user',
  'error',
  'revoked',
  'target-closed',
  'protocol-violation',
  'timeout',
  'peer-left',
]);
export const sessionStopSchema = z.strictObject({ reason: sessionStopReason });

export const controlMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelopeBase, type: z.literal('pointer.move'), payload: pointerMoveSchema }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal('pointer.down'),
    payload: pointerButtonSchema,
  }),
  z.strictObject({ ...envelopeBase, type: z.literal('pointer.up'), payload: pointerButtonSchema }),
  z.strictObject({ ...envelopeBase, type: z.literal('wheel'), payload: wheelSchema }),
  z.strictObject({ ...envelopeBase, type: z.literal('key.down'), payload: keyEventSchema }),
  z.strictObject({ ...envelopeBase, type: z.literal('key.up'), payload: keyEventSchema }),
  z.strictObject({ ...envelopeBase, type: z.literal('text.insert'), payload: textInsertSchema }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal('viewport.request'),
    payload: viewportRequestSchema,
  }),
  z.strictObject({ ...envelopeBase, type: z.literal('session.stop'), payload: sessionStopSchema }),
]);

export type ControlMessageType =
  | 'pointer.move'
  | 'pointer.down'
  | 'pointer.up'
  | 'wheel'
  | 'key.down'
  | 'key.up'
  | 'text.insert'
  | 'viewport.request'
  | 'session.stop';
export type ControlMessage = z.output<typeof controlMessageSchema>;
export type ControlPayload<T extends ControlMessageType = ControlMessageType> = Extract<
  ControlMessage,
  { type: T }
>['payload'];

export const CONTROL_MESSAGE_TYPES = [
  'pointer.move',
  'pointer.down',
  'pointer.up',
  'wheel',
  'key.down',
  'key.up',
  'text.insert',
  'viewport.request',
  'session.stop',
] as const satisfies readonly ControlMessageType[];

/** Validate an already-parsed control frame object (envelope + payload). */
export function parseControlMessage(data: unknown): ParseResult<ControlMessage> {
  return parseWith(controlMessageSchema, data);
}

/**
 * Decode raw DataChannel text → validated control message, enforcing the
 * serialized size bound before JSON parsing.
 */
export function decodeControlFrame(text: string): ParseResult<ControlMessage> {
  const frame = decodeJsonFrame(text, MAX_CONTROL_FRAME_BYTES);
  if (!frame.ok) return frame;
  return parseControlMessage(frame.value);
}

/** Encode + size-bound a control frame for sending. Throws on programmer error. */
export function encodeControlFrame(message: ControlMessage): string {
  const text = JSON.stringify(message);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_CONTROL_FRAME_BYTES) {
    throw new ProtocolError(
      'MESSAGE_TOO_LARGE',
      `control frame exceeds ${MAX_CONTROL_FRAME_BYTES} bytes`,
    );
  }
  return text;
}

/**
 * Outgoing control frame factory bound to one session. Owns the monotonic seq
 * counter so senders cannot accidentally emit duplicates or gaps.
 */
export class ControlSender {
  private seq = 0;

  constructor(readonly sessionId: string) {}

  private frame<T extends ControlMessageType>(type: T, payload: ControlPayload<T>): ControlMessage {
    this.seq += 1;
    const message = {
      v: 1,
      sessionId: this.sessionId,
      seq: this.seq,
      ts: Date.now(),
      type,
      payload,
    } as ControlMessage;
    const check = controlMessageSchema.safeParse(message);
    if (!check.success) {
      this.seq -= 1;
      throw new ProtocolError('MESSAGE_INVALID', `constructed ${type} frame violates its schema`);
    }
    return message;
  }

  pointerMove(x: number, y: number) {
    return encodeControlFrame(this.frame('pointer.move', { x, y }));
  }

  pointerDown(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', clickCount = 1) {
    return encodeControlFrame(this.frame('pointer.down', { x, y, button, clickCount }));
  }

  pointerUp(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', clickCount = 1) {
    return encodeControlFrame(this.frame('pointer.up', { x, y, button, clickCount }));
  }

  wheel(x: number, y: number, deltaX: number, deltaY: number) {
    return encodeControlFrame(this.frame('wheel', { x, y, deltaX, deltaY }));
  }

  keyDown(key: string, code: string, modifiers = MODIFIER.NONE) {
    return encodeControlFrame(this.frame('key.down', { key, code, modifiers }));
  }

  keyUp(key: string, code: string, modifiers = MODIFIER.NONE) {
    return encodeControlFrame(this.frame('key.up', { key, code, modifiers }));
  }

  insertText(text: string) {
    return encodeControlFrame(this.frame('text.insert', { text }));
  }

  viewportRequest() {
    return encodeControlFrame(this.frame('viewport.request', {}));
  }

  sessionStop(reason: z.output<typeof sessionStopReason>) {
    return encodeControlFrame(this.frame('session.stop', { reason }));
  }
}

/** Guard helper: validate a frame AND its sequence number for a session. */
export function acceptControlFrame(
  text: string,
  guard: SequenceGuard,
  expectedSessionId: string,
): ParseResult<ControlMessage> {
  const parsed = decodeControlFrame(text);
  if (!parsed.ok) return parsed;
  if (parsed.value.sessionId !== expectedSessionId) {
    return {
      ok: false,
      error: new ProtocolError('MESSAGE_INVALID', 'sessionId does not match the active session'),
    };
  }
  const seq = guard.check(parsed.value.seq);
  if (!seq.ok) return seq;
  return parsed;
}
