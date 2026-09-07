import { base64urlToBytes, bytesToBase64url } from './b64.ts';
import { randomBytes, timingSafeEqual } from './random.ts';
import { encodeTranscript } from './transcript.ts';

/**
 * One-time pairing proof (issues #013). The 256-bit secret is generated on the
 * laptop, delivered to the phone out-of-band via QR (URL fragment), and never
 * passes through the signaling service. The phone proves knowledge of the
 * secret with HMAC-SHA-256 over a transcript that binds both device
 * identities, so a stolen QR alone (without replacing a device key) or a
 * pairing proof replay from another pairing cannot verify.
 */

export const PAIRING_DOMAIN = 'remotetab.v1.pairing';
/** 256-bit one-time pairing secret. */
export const PAIRING_SECRET_BYTES = 32;
/** 128-bit pairing nonce binding the proof to one pairing session. */
export const PAIRING_NONCE_BYTES = 16;

export type PairingTranscript = {
  protocolVersion: string;
  desktopDeviceId: string;
  phoneDeviceId: string;
  desktopFingerprint: string;
  phoneFingerprint: string;
  /** Epoch ms after which the pairing must be rejected. */
  expiresAtMs: number;
  nonce: string;
};

export function generatePairingSecret(): string {
  return bytesToBase64url(randomBytes(PAIRING_SECRET_BYTES));
}

export function generatePairingNonce(): string {
  return bytesToBase64url(randomBytes(PAIRING_NONCE_BYTES));
}

function pairingTranscriptFields(t: PairingTranscript): string[] {
  return [
    PAIRING_DOMAIN,
    t.protocolVersion,
    t.desktopDeviceId,
    t.phoneDeviceId,
    t.desktopFingerprint,
    t.phoneFingerprint,
    String(t.expiresAtMs),
    t.nonce,
  ];
}

/** HMAC-SHA-256(key = secret, data = canonical pairing transcript). */
export async function pairingProof(
  secretB64: string,
  transcript: PairingTranscript,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64urlToBytes(secretB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encodeTranscript(pairingTranscriptFields(transcript)),
  );
  return new Uint8Array(mac);
}

/**
 * Constant-time verification of a base64url pairing proof. Returns false for
 * any malformed input; never throws, never exposes the computed MAC.
 */
export async function verifyPairingProof(
  secretB64: string,
  transcript: PairingTranscript,
  proofB64: string,
): Promise<boolean> {
  try {
    const expected = await pairingProof(secretB64, transcript);
    const provided = base64urlToBytes(proofB64);
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}
