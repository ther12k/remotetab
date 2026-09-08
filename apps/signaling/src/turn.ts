/**
 * Short-lived TURN credentials (issue #017, ADR-003). Implements the coturn
 * REST API ("use-auth-secret"): username = "<expiryUnix>:<deviceId>",
 * credential = base64(HMAC-SHA1(sharedSecret, username)). The shared secret
 * NEVER leaves the signaling service; clients receive per-session
 * credentials that expire with the timestamp in the username.
 *
 * Issuance is authenticated (#29): the client signs a canonical transcript
 * with its registered device key — an internet-facing endpoint must not be
 * an open credential mint.
 */

import {
  base64urlToBytes,
  encodeTranscript,
  fingerprintFromSpkiB64,
  importPublicKeySpki,
} from '@remotetab/crypto';
import { TURN_AUTH_DOMAIN } from '@remotetab/protocol';

export type TurnCredentials = {
  username: string;
  credential: string;
  ttlSeconds: number;
};

async function hmacSha1(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** Mint time-limited credentials bound to a device id. */
export async function mintTurnCredentials(opts: {
  secret: string;
  deviceId: string;
  ttlSeconds?: number;
  nowUnix?: number;
}): Promise<TurnCredentials> {
  const ttlSeconds = opts.ttlSeconds ?? 600;
  const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);
  const expiry = nowUnix + ttlSeconds;
  const username = `${expiry}:${opts.deviceId}`;
  const credential = await hmacSha1(opts.secret, username);
  return { username, credential, ttlSeconds };
}

/** Verify the shape of a client-supplied device id before minting. */
export function isValidTurnDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(deviceId);
}

/** Assemble the RTCIceServer entry the client should use for TURN. */
export function turnIceServer(
  urls: string[],
  cred: TurnCredentials,
): { urls: string[]; username: string; credential: string } {
  return { urls, username: cred.username, credential: cred.credential };
}

// -----------------------------------------------------------------------------
// Signed credential requests (#29)
// -----------------------------------------------------------------------------

const BASE64URL_SHAPE = /^[A-Za-z0-9_-]{2,512}$/;

/** The body a client must present to POST /turn/credentials. */
export type TurnAuthRequest = {
  deviceId: string;
  /** Client unix ms; accepted within a small skew window. */
  timestamp: number;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  signature: string;
};

export function isTurnAuthRequest(value: unknown): value is TurnAuthRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isValidTurnDeviceId(v.deviceId) &&
    typeof v.timestamp === 'number' &&
    Number.isSafeInteger(v.timestamp) &&
    typeof v.publicKeySpki === 'string' &&
    BASE64URL_SHAPE.test(v.publicKeySpki) &&
    typeof v.publicKeyFingerprint === 'string' &&
    BASE64URL_SHAPE.test(v.publicKeyFingerprint) &&
    typeof v.signature === 'string' &&
    BASE64URL_SHAPE.test(v.signature)
  );
}

export type TurnAuthVerdict = 'ok' | 'stale' | 'fingerprint' | 'signature';

/**
 * Verify a signed TURN request against the REGISTERED device identity
 * (continuity is checked by the caller against the registry record).
 */
export async function verifyTurnAuthRequest(
  req: TurnAuthRequest,
  nowMs: number,
  skewMs = 60_000,
): Promise<TurnAuthVerdict> {
  if (Math.abs(nowMs - req.timestamp) > skewMs) return 'stale';
  // The claimed fingerprint must describe the presented key bytes (#23).
  const computed = await fingerprintFromSpkiB64(req.publicKeySpki);
  if (computed !== req.publicKeyFingerprint) return 'fingerprint';
  try {
    const pub = await importPublicKeySpki(base64urlToBytes(req.publicKeySpki));
    const transcript = encodeTranscript([
      TURN_AUTH_DOMAIN,
      '1',
      req.deviceId,
      String(req.timestamp),
    ]);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      base64urlToBytes(req.signature),
      transcript,
    );
    return ok ? 'ok' : 'signature';
  } catch {
    return 'signature';
  }
}
