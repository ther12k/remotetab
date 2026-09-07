import { base64urlToBytes, bytesToBase64url } from './b64.ts';
import { randomBytes } from './random.ts';
import { encodeTranscript } from './transcript.ts';

/**
 * Fresh per-session mutual peer proof (issue #014). After the DataChannel
 * opens, each side signs a canonical transcript with its device key. Control
 * input stays disabled until BOTH proofs verify against the stored peer
 * public key. The transcript binds session id, both identities, role, and a
 * fresh nonce, so proofs cannot be replayed into another session and a phone
 * proof cannot be reflected as a desktop proof.
 */

export const PEER_AUTH_DOMAIN = 'remotetab.v1.peer-auth';
/** 128-bit challenge nonce. */
export const CHALLENGE_NONCE_BYTES = 16;

export type PeerProofTranscript = {
  protocolVersion: string;
  sessionId: string;
  desktopDeviceId: string;
  phoneDeviceId: string;
  desktopFingerprint: string;
  phoneFingerprint: string;
  /** Role this proof is issued FOR: signer's own role. */
  role: 'desktop' | 'phone';
  nonce: string;
};

export function generateChallengeNonce(): string {
  return bytesToBase64url(randomBytes(CHALLENGE_NONCE_BYTES));
}

function peerTranscriptFields(t: PeerProofTranscript): string[] {
  return [
    PEER_AUTH_DOMAIN,
    t.protocolVersion,
    t.sessionId,
    t.desktopDeviceId,
    t.phoneDeviceId,
    t.desktopFingerprint,
    t.phoneFingerprint,
    t.role,
    t.nonce,
  ];
}

/** ECDSA P-256/SHA-256 signature over the canonical peer transcript. */
export async function signPeerProof(
  privateKey: CryptoKey,
  transcript: PeerProofTranscript,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encodeTranscript(peerTranscriptFields(transcript)),
  );
  return bytesToBase64url(new Uint8Array(sig));
}

/**
 * Verify a peer proof against the stored peer public key. Returns false for
 * any malformed input or wrong key; never throws.
 */
export async function verifyPeerProof(
  publicKey: CryptoKey,
  transcript: PeerProofTranscript,
  signatureB64: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64urlToBytes(signatureB64),
      encodeTranscript(peerTranscriptFields(transcript)),
    );
  } catch {
    return false;
  }
}
