import { z } from 'zod';
import { MAX_SIGNALING_FRAME_BYTES } from './limits.ts';
import { ProtocolError } from './protocol-error.ts';

/** Domain separator for the signaling WS device-auth transcript (#018). */
export const WS_AUTH_DOMAIN = 'remotetab.v1.ws-auth';

/** Domain separator for the signed TURN credential request transcript (#29). */
export const TURN_AUTH_DOMAIN = 'remotetab.v1.turn-auth';

/**
 * Shared wire primitives. Every object schema in this package is strict:
 * unknown keys are rejected so undeclared fields can never smuggle behavior.
 */

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'invalid id shape');
export const displayableText = (max: number) => z.string().min(0).max(max);
export const unitCoord = z.number().finite().min(0).max(1);
export const finiteNumber = z.number().finite();
export const timestampMs = z.number().int().finite().positive();
export const seqNumber = z.number().int().finite().min(1).max(Number.MAX_SAFE_INTEGER);

/** Result-style parse outcome; network edges must not rely on exceptions. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolError };

/** Turn a zod failure into a ProtocolError without echoing message content. */
export function toProtocolError(
  error: z.ZodError,
  fallbackCode: 'MESSAGE_INVALID' | 'MESSAGE_TOO_LARGE' = 'MESSAGE_INVALID',
): ProtocolError {
  const issue = error.issues[0];
  const path = issue ? issue.path.map((p) => p.toString()).join('.') : '';
  return new ProtocolError(fallbackCode, path ? `schema mismatch at ${path}` : 'schema mismatch');
}

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): ParseResult<T> {
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: toProtocolError(result.error) };
}

/**
 * Decode a JSON text frame with a hard size bound. The bound is enforced on
 * the serialized input before JSON.parse, so oversized frames never reach a
 * parser.
 */
export function decodeJsonFrame(text: string, maxBytes: number): ParseResult<unknown> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) {
    return {
      ok: false,
      error: new ProtocolError('MESSAGE_TOO_LARGE', `frame exceeds ${maxBytes} bytes`),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: new ProtocolError('MESSAGE_INVALID', 'frame is not valid JSON') };
  }
}

/**
 * Monotonic per-session sequence guard. On a reliable ordered DataChannel the
 * sender must emit seq = 1, 2, 3, …; anything else (repeat, rollback, gap) is
 * rejected as a replay/protocol violation.
 */
export class SequenceGuard {
  private lastSeq = 0;

  /** @returns ok when `seq` is exactly the next expected number. */
  check(seq: number): ParseResult<{ accepted: true }> {
    if (!Number.isSafeInteger(seq) || seq < 1) {
      return {
        ok: false,
        error: new ProtocolError('MESSAGE_INVALID', 'seq must be a positive safe integer'),
      };
    }
    if (seq <= this.lastSeq) {
      return {
        ok: false,
        error: new ProtocolError(
          'REPLAY_REJECTED',
          `seq ${seq} repeats or rolls back past ${this.lastSeq}`,
        ),
      };
    }
    if (seq !== this.lastSeq + 1) {
      return {
        ok: false,
        error: new ProtocolError(
          'MESSAGE_INVALID',
          `seq gap: expected ${this.lastSeq + 1}, got ${seq}`,
        ),
      };
    }
    this.lastSeq = seq;
    return { ok: true, value: { accepted: true } };
  }

  get last(): number {
    return this.lastSeq;
  }
}

/** Common envelope header fields shared by control frames. */
export const envelopeBase = {
  v: z.literal(1),
  sessionId: idSchema,
  seq: seqNumber,
  ts: timestampMs,
};

/** Signaling frames travel a different transport and have their own header. */
export const signalingEnvelopeBase = {
  v: z.literal(1),
  /** Optional client-generated correlation id for request/response flows. */
  id: idSchema.optional(),
  /** Set by responders to correlate with the requesting `id`. */
  replyTo: idSchema.optional(),
};

export const MAX_SIGNALING_BYTES = MAX_SIGNALING_FRAME_BYTES;
