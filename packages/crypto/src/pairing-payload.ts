/**
 * Pairing QR payload (issue #013). The 256-bit SECRET lives here and is
 * delivered out-of-band (camera scan / pasted code). It never passes through
 * the signaling service, which only sees the pairId.
 *
 * Wire format: `RT1:` + base64url(compact JSON). Scanners in camera apps may
 * wrap the payload in a URL; everything after the first `#p=` fragment (or an
 * RT1: token) is accepted.
 */

import { base64urlToBytes, bytesToBase64url } from './b64.ts';

export type PairingPayloadV1 = {
  v: 1;
  /** Origin of the signaling service, e.g. wss://signal.example.com/ws */
  signalingOrigin: string;
  pairId: string;
  desktopDeviceId: string;
  /** Desktop ECDSA P-256 SPKI public key, base64url. */
  desktopSpki: string;
  desktopFingerprint: string;
  expiresAtMs: number;
  nonce: string;
  /** The one-time 256-bit secret, base64url. Never sent to the server. */
  secret: string;
};

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

const PREFIX = 'RT1:';

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const B64 = /^[A-Za-z0-9_-]{8,}$/;

export function encodePairingPayload(payload: PairingPayloadV1): string {
  return PREFIX + bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodePairingPayload(raw: string): ParseOutcome<PairingPayloadV1> {
  const fail = (reason: string): ParseOutcome<PairingPayloadV1> => ({ ok: false, reason });
  // Accept a full URL that carries the payload in its fragment (#p=… or #/…).
  let token = raw.trim();
  const hash = token.indexOf('p=');
  if (token.includes('#') && hash > 0) {
    token = token.slice(hash + 2);
  }
  if (!token.startsWith(PREFIX)) return fail('missing RT1 prefix');
  let json: string;
  try {
    json = new TextDecoder().decode(base64urlToBytes(token.slice(PREFIX.length)));
  } catch {
    return fail('payload is not valid base64url');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return fail('payload is not valid JSON');
  }
  if (typeof obj !== 'object' || obj === null) return fail('payload is not an object');
  const p = obj as Record<string, unknown>;
  if (p.v !== 1) return fail('unsupported payload version');
  for (const [key, guard] of [
    ['signalingOrigin', (v: unknown) => typeof v === 'string' && /^wss?:\/\/.+/.test(v)],
    ['pairId', (v: unknown) => typeof v === 'string' && ID.test(v)],
    ['desktopDeviceId', (v: unknown) => typeof v === 'string' && ID.test(v)],
    ['desktopSpki', (v: unknown) => typeof v === 'string' && B64.test(v)],
    ['desktopFingerprint', (v: unknown) => typeof v === 'string' && B64.test(v)],
    ['nonce', (v: unknown) => typeof v === 'string' && B64.test(v)],
    ['secret', (v: unknown) => typeof v === 'string' && B64.test(v)],
  ] as const) {
    if (!guard(p[key])) return fail(`invalid field ${key}`);
  }
  if (typeof p.expiresAtMs !== 'number' || !Number.isFinite(p.expiresAtMs))
    return fail('invalid expiry');
  return {
    ok: true,
    value: {
      v: 1,
      signalingOrigin: p.signalingOrigin as string,
      pairId: p.pairId as string,
      desktopDeviceId: p.desktopDeviceId as string,
      desktopSpki: p.desktopSpki as string,
      desktopFingerprint: p.desktopFingerprint as string,
      expiresAtMs: p.expiresAtMs as number,
      nonce: p.nonce as string,
      secret: p.secret as string,
    },
  };
}
