import { z } from 'zod';
import { envelopeBase, idSchema, type ParseResult, parseWith } from './frame.ts';
import { BASE64URL_PATTERN, MAX_NONCE_LENGTH, MIN_NONCE_LENGTH } from './limits.ts';

/**
 * Peer authentication frames (issue #014). These travel the reliable
 * `control.v1` channel immediately after it opens; control input stays
 * disabled until both sides verify each other's proof.
 *
 * The signature transcript (built in @remotetab/crypto) binds protocol
 * version, session id, both device ids, both key fingerprints, role, and the
 * fresh challenge nonce — so proofs cannot be replayed into another session
 * or reflected across roles.
 */

export const nonceSchema = z
  .string()
  .regex(BASE64URL_PATTERN, 'nonce must be base64url')
  .refine((s) => {
    // base64url length maps 4 chars → 3 bytes; enforce the byte bounds loosely.
    const bytes = Math.floor((s.length * 3) / 4);
    return bytes >= 16 && s.length <= MAX_NONCE_LENGTH;
  }, `nonce must carry at least ${MIN_NONCE_LENGTH} chars of entropy`);

export const peerChallengeSchema = z.strictObject({
  nonce: nonceSchema,
  sessionId: idSchema,
});

export const peerProofSchema = z.strictObject({
  deviceId: idSchema,
  publicKeyFingerprint: z
    .string()
    .regex(BASE64URL_PATTERN, 'fingerprint must be base64url')
    .max(64),
  signature: z.string().regex(BASE64URL_PATTERN, 'signature must be base64url').max(512),
});

export const peerAuthMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelopeBase,
    type: z.literal('peer.challenge'),
    payload: peerChallengeSchema,
  }),
  z.strictObject({ ...envelopeBase, type: z.literal('peer.proof'), payload: peerProofSchema }),
]);

export type PeerAuthMessage = z.output<typeof peerAuthMessageSchema>;
export type PeerChallenge = z.output<typeof peerChallengeSchema>;
export type PeerProof = z.output<typeof peerProofSchema>;

export function parsePeerAuthMessage(data: unknown): ParseResult<PeerAuthMessage> {
  return parseWith(peerAuthMessageSchema, data);
}
