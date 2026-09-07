/**
 * Short-lived TURN credentials (issue #017, ADR-003). Implements the coturn
 * REST API ("use-auth-secret"): username = "<expiryUnix>:<deviceId>",
 * credential = base64(HMAC-SHA1(sharedSecret, username)). The shared secret
 * NEVER leaves the signaling service; clients receive per-session
 * credentials that expire with the timestamp in the username.
 */

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
