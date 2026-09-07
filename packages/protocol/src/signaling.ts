import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors.ts';
import {
  decodeJsonFrame,
  displayableText,
  idSchema,
  MAX_SIGNALING_BYTES,
  type ParseResult,
  parseWith,
  signalingEnvelopeBase,
} from './frame.ts';
import { BASE64URL_PATTERN, MAX_DISPLAY_NAME_LENGTH } from './limits.ts';
import { ProtocolError } from './protocol-error.ts';

/**
 * Signaling messages (WSS). Signaling routes metadata only — it never carries
 * media, page content, credentials, or pairing secrets. The server enforces
 * these schemas on every inbound frame.
 */

export const deviceRole = z.enum(['desktop', 'phone']);

export const helloSchema = z.strictObject({
  role: deviceRole,
  deviceId: idSchema,
  displayName: displayableText(MAX_DISPLAY_NAME_LENGTH).optional(),
});

export const helloOkSchema = z.strictObject({
  heartbeatIntervalSec: z.number().int().min(1).max(600),
  heartbeatTimeoutSec: z.number().int().min(1).max(3600),
});

export const pairCreateSchema = z.strictObject({
  ttlSeconds: z.number().int().min(30).max(300).default(300),
  /** Desktop ECDSA P-256 SPKI public key, base64url — relayed in pair.accepted. */
  publicKeySpki: z.string().regex(BASE64URL_PATTERN).max(256),
  /** Desktop key fingerprint; the phone checks it against the QR it scanned. */
  publicKeyFingerprint: z.string().regex(BASE64URL_PATTERN).max(64),
  displayName: displayableText(MAX_DISPLAY_NAME_LENGTH).optional(),
});

export const pairCreatedSchema = z.strictObject({
  pairId: idSchema,
  expiresAtMs: z.number().int().finite().positive(),
});

export const pairJoinSchema = z.strictObject({
  pairId: idSchema,
  deviceId: idSchema,
  displayName: displayableText(MAX_DISPLAY_NAME_LENGTH).optional(),
  /** Phone ECDSA P-256 SPKI public key, base64url. */
  publicKeySpki: z.string().regex(BASE64URL_PATTERN).max(256),
  /** SHA-256 fingerprint of the SPKI key, base64url. */
  publicKeyFingerprint: z.string().regex(BASE64URL_PATTERN).max(64),
  /** HMAC-SHA-256 pairing proof over the pairing transcript, base64url. */
  pairingProof: z.string().regex(BASE64URL_PATTERN).max(128),
});

export const pairAcceptSchema = z.strictObject({ pairId: idSchema });
export const pairRejectSchema = z.strictObject({
  pairId: idSchema,
  code: z.enum(['PAIR_EXPIRED', 'PAIR_INVALID_PROOF', 'PAIR_ALREADY_USED', 'MESSAGE_INVALID']),
});

export const pairAcceptedSchema = z.strictObject({
  pairId: idSchema,
  desktop: z.strictObject({
    deviceId: idSchema,
    displayName: displayableText(MAX_DISPLAY_NAME_LENGTH).optional(),
    publicKeySpki: z.string().regex(BASE64URL_PATTERN).max(256),
    publicKeyFingerprint: z.string().regex(BASE64URL_PATTERN).max(64),
  }),
  phone: z.strictObject({
    deviceId: idSchema,
    displayName: displayableText(MAX_DISPLAY_NAME_LENGTH).optional(),
    publicKeySpki: z.string().regex(BASE64URL_PATTERN).max(256),
    publicKeyFingerprint: z.string().regex(BASE64URL_PATTERN).max(64),
  }),
});

export const sessionRequestSchema = z.strictObject({
  deviceId: idSchema,
  /** Target desktop for the session. */
  desktopDeviceId: idSchema,
});

export const sessionAcceptedSchema = z.strictObject({
  sessionId: idSchema,
  desktopDeviceId: idSchema,
  phoneDeviceId: idSchema,
});

export const sessionRejectedSchema = z.strictObject({
  code: z.enum(['SESSION_NOT_FOUND', 'SESSION_CONFLICT', 'DEVICE_REVOKED', 'MESSAGE_INVALID']),
});

export const sessionCloseSchema = z.strictObject({
  sessionId: idSchema,
  reason: z.enum(['user', 'error', 'revoked', 'timeout', 'peer-left']),
});

/** SDP/ICE payloads are opaque validated strings, never logged in production. */
const sdp = z.string().min(1).max(48_000);

export const signalOfferSchema = z.strictObject({ sessionId: idSchema, sdp });
export const signalAnswerSchema = z.strictObject({ sessionId: idSchema, sdp });
export const signalIceSchema = z.strictObject({
  sessionId: idSchema,
  candidate: z.string().max(2048),
  sdpMid: z.string().max(16).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable(),
  usernameFragment: z.string().max(128).nullable(),
});

export const presencePingSchema = z.strictObject({ ts: z.number().int().finite().positive() });
export const presencePongSchema = z.strictObject({ ts: z.number().int().finite().positive() });

export const signalingErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: displayableText(256).optional(),
});

export const signalingMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...signalingEnvelopeBase, type: z.literal('hello'), payload: helloSchema }),
  z.strictObject({ ...signalingEnvelopeBase, type: z.literal('hello.ok'), payload: helloOkSchema }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.create'),
    payload: pairCreateSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.created'),
    payload: pairCreatedSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.join'),
    payload: pairJoinSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.accept'),
    payload: pairAcceptSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.accepted'),
    payload: pairAcceptedSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.reject'),
    payload: pairRejectSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('pair.rejected'),
    payload: pairRejectSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('session.request'),
    payload: sessionRequestSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('session.accepted'),
    payload: sessionAcceptedSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('session.rejected'),
    payload: sessionRejectedSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('session.close'),
    payload: sessionCloseSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('signal.offer'),
    payload: signalOfferSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('signal.answer'),
    payload: signalAnswerSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('signal.ice'),
    payload: signalIceSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('presence.ping'),
    payload: presencePingSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('presence.pong'),
    payload: presencePongSchema,
  }),
  z.strictObject({
    ...signalingEnvelopeBase,
    type: z.literal('error'),
    payload: signalingErrorSchema,
  }),
]);

export type SignalingMessageType =
  | 'hello'
  | 'hello.ok'
  | 'pair.create'
  | 'pair.created'
  | 'pair.join'
  | 'pair.accept'
  | 'pair.accepted'
  | 'pair.reject'
  | 'pair.rejected'
  | 'session.request'
  | 'session.accepted'
  | 'session.rejected'
  | 'session.close'
  | 'signal.offer'
  | 'signal.answer'
  | 'signal.ice'
  | 'presence.ping'
  | 'presence.pong'
  | 'error';
export type SignalingMessage = z.output<typeof signalingMessageSchema>;
export type SignalingPayload<T extends SignalingMessageType = SignalingMessageType> = Extract<
  SignalingMessage,
  { type: T }
>['payload'];

export const SIGNALING_MESSAGE_TYPES = [
  'hello',
  'hello.ok',
  'pair.create',
  'pair.created',
  'pair.join',
  'pair.accept',
  'pair.accepted',
  'pair.reject',
  'pair.rejected',
  'session.request',
  'session.accepted',
  'session.rejected',
  'session.close',
  'signal.offer',
  'signal.answer',
  'signal.ice',
  'presence.ping',
  'presence.pong',
  'error',
] as const satisfies readonly SignalingMessageType[];

export function parseSignalingMessage(data: unknown): ParseResult<SignalingMessage> {
  return parseWith(signalingMessageSchema, data);
}

export function decodeSignalingFrame(text: string): ParseResult<SignalingMessage> {
  const frame = decodeJsonFrame(text, MAX_SIGNALING_BYTES);
  if (!frame.ok) return frame;
  return parseSignalingMessage(frame.value);
}

/** Build a signaling frame. `id` correlates responses with requests. */
export function signalingFrame<T extends SignalingMessageType>(
  type: T,
  payload: SignalingPayload<T>,
  correlation?: { id?: string; replyTo?: string },
): SignalingMessage {
  return {
    v: 1,
    ...(correlation?.id ? { id: correlation.id } : {}),
    ...(correlation?.replyTo ? { replyTo: correlation.replyTo } : {}),
    type,
    payload,
  } as SignalingMessage;
}

export function signalingErrorFrame(
  replyTo: string,
  code: ErrorCode,
  message?: string,
): SignalingMessage {
  return signalingFrame<'error'>('error', { code, ...(message ? { message } : {}) }, { replyTo });
}

/** Convenience for responders that must fail with a protocol error. */
export function errorFor(code: ErrorCode, reason: string): ProtocolError {
  return new ProtocolError(code, reason);
}
