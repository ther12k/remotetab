/**
 * Authenticated TURN credential issuance (#29): only devices whose key is
 * registered (and matching) get credentials; everything else is refused and
 * per-device issuance is rate limited.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  bytesToBase64url,
  encodeTranscript,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
  generateSigningKeyPair,
} from '@remotetab/crypto';
import { TURN_AUTH_DOMAIN } from '@remotetab/protocol';
import { parseEnv } from '../src/env.ts';
import { noopLogger } from '../src/logger.ts';
import { type ServerHandle, startServer } from '../src/server.ts';

let server: ServerHandle;
let base: string;

beforeAll(() => {
  server = startServer({
    env: {
      ...parseEnv({
        PORT: '0',
        TURN_SECRET: 'test-turn-secret-0001',
        TURN_URLS: 'turn:turn.test:3478',
        ADMIN_TOKEN: 'test-admin-token',
      }),
      port: 0,
    },
    log: noopLogger,
  });
  base = `http://localhost:${server.port}/turn/credentials`;
});

afterAll(async () => {
  await server.stop();
});

async function enroll(deviceId: string): Promise<CryptoKeyPair> {
  const pair = await generateSigningKeyPair();
  const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
  const fp = await fingerprintFromSpkiB64(spki);
  server.devices.enroll(deviceId, spki, fp, 'Test device');
  return pair;
}

async function request(opts: {
  deviceId: string;
  priv: CryptoKey;
  spki: string;
  fp: string;
  timestamp?: number;
  signatureOverride?: string;
}): Promise<Response> {
  const timestamp = opts.timestamp ?? Date.now();
  const signature =
    opts.signatureOverride ??
    bytesToBase64url(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          opts.priv,
          encodeTranscript([TURN_AUTH_DOMAIN, '1', opts.deviceId, String(timestamp)]),
        ),
      ),
    );
  return fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: opts.deviceId,
      timestamp,
      publicKeySpki: opts.spki,
      publicKeyFingerprint: opts.fp,
      signature,
    }),
  });
}

describe('POST /turn/credentials (authenticated, #29)', () => {
  test('a registered device with a valid signature gets credentials', async () => {
    const deviceId = 'dev_turnvalid0000001';
    const pair = await enroll(deviceId);
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({ deviceId, priv: pair.privateKey, spki, fp });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      username: string;
      iceServers: { urls: string[]; username: string; credential: string }[];
    };
    expect(body.username).toContain(deviceId);
    expect(body.iceServers[0]?.urls).toEqual(['turn:turn.test:3478']);
  });

  test('an unregistered device is refused', async () => {
    const pair = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({
      deviceId: 'dev_neverseen00001',
      priv: pair.privateKey,
      spki,
      fp,
    });
    expect(res.status).toBe(403);
  });

  test('a wrong signature is rejected', async () => {
    const deviceId = 'dev_turnbadsig000001';
    const pair = await enroll(deviceId);
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({
      deviceId,
      priv: pair.privateKey,
      spki,
      fp,
      signatureOverride: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(res.status).toBe(401);
  });

  test('a stale timestamp is rejected', async () => {
    const deviceId = 'dev_turnstale0000001';
    const pair = await enroll(deviceId);
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({
      deviceId,
      priv: pair.privateKey,
      spki,
      fp,
      timestamp: Date.now() - 10 * 60_000,
    });
    expect(res.status).toBe(401);
  });

  test('an identity mismatch (different key than registered) is refused', async () => {
    const deviceId = 'dev_turnmismatch0001';
    const registered = await enroll(deviceId);
    void registered;
    const impostor = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(impostor.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({ deviceId, priv: impostor.privateKey, spki, fp });
    expect(res.status).toBe(403);
  });

  test('a revoked device is refused', async () => {
    const deviceId = 'dev_turnrevoked0001';
    const pair = await enroll(deviceId);
    server.devices.revoke(deviceId, Date.now());
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const res = await request({ deviceId, priv: pair.privateKey, spki, fp });
    expect(res.status).toBe(403);
  });

  test('issuance is rate limited per device', async () => {
    const deviceId = 'dev_turnflood0000001';
    const pair = await enroll(deviceId);
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    let lastStatus = 0;
    for (let i = 0; i < 14; i++) {
      lastStatus = (await request({ deviceId, priv: pair.privateKey, spki, fp })).status;
    }
    expect(lastStatus).toBe(429);
  });

  test('a malformed request body is rejected', async () => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev_shapetest00001' }),
    });
    expect(res.status).toBe(400);
  });
});
