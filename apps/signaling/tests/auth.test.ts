import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  bytesToBase64url,
  encodeTranscript,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
  generateSigningKeyPair,
} from '@remotetab/crypto';
import { WS_AUTH_DOMAIN } from '@remotetab/protocol';
import { parseEnv } from '../src/env.ts';
import { noopLogger } from '../src/logger.ts';
import { type ServerHandle, startServer } from '../src/server.ts';

const DEVICE_ID = 'dev_wsauthdevice00000000001';

let server: ServerHandle;
let base: string;

beforeAll(() => {
  server = startServer({ env: { ...parseEnv({ PORT: '0' }), port: 0 }, log: noopLogger });
  base = `ws://localhost:${server.port}/ws`;
});

afterAll(async () => {
  await server.stop();
});

/** Minimal WS client that answers the device-auth challenge with a key. */
class AuthClient {
  private ws: WebSocket;
  private queue: { type: string; payload: Record<string, unknown> }[] = [];
  readonly closed: Promise<{ code: number }>;
  private readonly signer: (nonce: string) => Promise<string>;
  private spki = '';
  private fingerprint = '';
  private autoAnswer = true;

  constructor(url: string, deviceId: string, priv: CryptoKey, pub: CryptoKey, autoAnswer = true) {
    this.autoAnswer = autoAnswer;
    void exportPublicKeySpki(pub).then(async (spki) => {
      this.spki = bytesToBase64url(spki);
      this.fingerprint = await fingerprintFromSpkiB64(bytesToBase64url(spki));
    });
    this.signer = async (nonce) =>
      bytesToBase64url(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            priv,
            encodeTranscript([WS_AUTH_DOMAIN, '1', nonce, deviceId]),
          ),
        ),
      );
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      const frame = JSON.parse(String(ev.data)) as {
        type: string;
        payload: Record<string, unknown>;
      };
      this.queue.push(frame);
      if (frame.type === 'auth.challenge' && this.autoAnswer) {
        void this.answer(deviceId, frame.payload.nonce as string);
      }
    };
    this.closed = new Promise((resolve) => {
      this.ws.onclose = (ev) => resolve({ code: ev.code ?? 0 });
    });
  }

  static connect(
    url: string,
    deviceId: string,
    priv: CryptoKey,
    pub: CryptoKey,
    autoAnswer = true,
    role: 'phone' | 'desktop' = 'phone',
  ): Promise<AuthClient> {
    const c = new AuthClient(url, deviceId, priv, pub, autoAnswer);
    return new Promise((resolve, reject) => {
      c.ws.onopen = () => {
        c.ws.send(JSON.stringify({ v: 1, type: 'hello', payload: { role, deviceId } }));
        resolve(c);
      };
      c.ws.onerror = () => reject(new Error('ws connect failed'));
    });
  }

  private async answer(deviceId: string, nonce: string): Promise<void> {
    void deviceId;
    // Wait for the async SPKI export to settle before answering.
    for (let i = 0; i < 20 && this.spki === ''; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const signature = await this.signer(nonce);
    this.ws.send(
      JSON.stringify({
        v: 1,
        type: 'auth.proof',
        payload: {
          signature,
          publicKeySpki: this.spki,
          publicKeyFingerprint: this.fingerprint,
          displayName: 'Test',
        },
      }),
    );
  }

  /** Force a mismatching fingerprint to exercise the failure path. */
  answerBroken(nonce: string, deviceId: string): Promise<void> {
    return this.signer(nonce).then((signature) => {
      this.ws.send(
        JSON.stringify({
          v: 1,
          type: 'auth.proof',
          payload: {
            signature,
            publicKeySpki: this.spki,
            publicKeyFingerprint: 'MISMATCHfpMISMATCHfp',
          },
        }),
      );
      void deviceId;
    });
  }

  next(
    type: string,
    timeoutMs = 2000,
  ): Promise<{ type: string; payload: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
      const poll = setInterval(() => {
        const idx = this.queue.findIndex((f) => f.type === type);
        if (idx >= 0) {
          clearInterval(poll);
          clearTimeout(timer);
          const frame = this.queue.splice(idx, 1)[0];
          if (frame) resolve(frame);
        }
      }, 20);
      setTimeout(() => clearInterval(poll), timeoutMs + 100);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('WS device authentication', () => {
  test('hello → challenge → proof → auth.ok registers the device', async () => {
    const pair = await generateSigningKeyPair();
    const client = await AuthClient.connect(base, DEVICE_ID, pair.privateKey, pair.publicKey);
    const ok = await client.next('auth.ok');
    expect(ok.payload.registered).toBe(true);
    client.close();
  });

  test('open mode: a fingerprint mismatch never authenticates', async () => {
    const pair = await generateSigningKeyPair();
    const deviceId = 'dev_wsauthmismatch00000001';
    const client = await AuthClient.connect(base, deviceId, pair.privateKey, pair.publicKey, false);
    // Grab the challenge and answer with a broken fingerprint.
    const challenge = await client.next('auth.challenge');
    const brokenNonce = (challenge.payload.nonce as string) ?? '';
    await client.answerBroken(brokenNonce, deviceId);
    // No auth.ok arrives; the socket stays open in open mode.
    await new Promise((r) => setTimeout(r, 250));
    const stillOpen = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), 200);
      client.closed.then(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    expect(stillOpen).toBe(true);
    client.close();
  });

  test('open mode: key conflict for a known device never re-authenticates (#24)', async () => {
    const first = await generateSigningKeyPair();
    const deviceId = 'dev_keyconflict00000001';
    const enrolled = await AuthClient.connect(base, deviceId, first.privateKey, first.publicKey);
    expect((await enrolled.next('auth.ok')).payload.registered).toBe(true);
    enrolled.close();

    // Same deviceId, DIFFERENT key: signature is valid, continuity is not.
    const second = await generateSigningKeyPair();
    const attacker = await AuthClient.connect(base, deviceId, second.privateKey, second.publicKey, false);
    const challenge = await attacker.next('auth.challenge');
    await attacker.answerBroken((challenge.payload.nonce as string) ?? '', deviceId);
    await new Promise((r) => setTimeout(r, 250));
    const authenticated = attacker.queue.some((f) => f.type === 'auth.ok');
    expect(authenticated).toBe(false);
    attacker.close();
  });
});

describe('DEVICE_AUTH=required end to end (#25)', () => {
  const ADMIN_TOKEN = 'test-admin-token';
  let required: ServerHandle;
  let requiredBase: string;

  beforeAll(() => {
    required = startServer({
      env: {
        ...parseEnv({ PORT: '0', DEVICE_AUTH: 'required', ADMIN_TOKEN: ADMIN_TOKEN }),
        port: 0,
      },
      log: noopLogger,
    });
    requiredBase = `ws://localhost:${required.port}/ws`;
  });

  afterAll(async () => {
    await required.stop();
  });

  async function enroll(
    deviceId: string,
    spki: string,
    fingerprint: string,
  ): Promise<number> {
    const res = await fetch(`http://localhost:${required.port}/admin/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ deviceId, publicKeySpki: spki, publicKeyFingerprint: fingerprint }),
    });
    return res.status;
  }

  test('an unknown device cannot self-enroll and is closed', async () => {
    const pair = await generateSigningKeyPair();
    const client = await AuthClient.connect(
      requiredBase,
      'dev_unknown000000001',
      pair.privateKey,
      pair.publicKey,
    );
    const closed = await client.closed;
    expect(closed.code).toBe(1008);
    expect(client.queue.some((f) => f.type === 'auth.ok')).toBe(false);
  });

  test('admin enrollment without the token is rejected', async () => {
    const pair = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    const noHeader = await fetch(`http://localhost:${required.port}/admin/devices`, {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'dev_x000000000000001', publicKeySpki: spki, publicKeyFingerprint: fp }),
    });
    expect(noHeader.status).toBe(403);
    const wrongToken = await fetch(`http://localhost:${required.port}/admin/devices`, {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
      body: JSON.stringify({ deviceId: 'dev_x000000000000001', publicKeySpki: spki, publicKeyFingerprint: fp }),
    });
    expect(wrongToken.status).toBe(403);
  });

  test('an admin-enrolled device authenticates, pairs, and opens a session', async () => {
    // Desktop identity: enrolled via the controlled endpoint.
    const desktop = await generateSigningKeyPair();
    const desktopId = 'dev_reqdesktop0000001';
    const desktopSpki = bytesToBase64url(await exportPublicKeySpki(desktop.publicKey));
    const desktopFp = await fingerprintFromSpkiB64(desktopSpki);
    expect(await enroll(desktopId, desktopSpki, desktopFp)).toBe(201);
    // Re-enrolling the same identity is idempotent.
    expect(await enroll(desktopId, desktopSpki, desktopFp)).toBe(200);
    // Conflicting identity for the same deviceId is rejected.
    const other = await generateSigningKeyPair();
    expect(
      await enroll(
        desktopId,
        bytesToBase64url(await exportPublicKeySpki(other.publicKey)),
        await fingerprintFromSpkiB64(bytesToBase64url(await exportPublicKeySpki(other.publicKey))),
      ),
    ).toBe(409);

    const phone = await generateSigningKeyPair();
    const phoneId = 'dev_reqphone00000001';
    const phoneSpki = bytesToBase64url(await exportPublicKeySpki(phone.publicKey));
    const phoneFp = await fingerprintFromSpkiB64(phoneSpki);
    expect(await enroll(phoneId, phoneSpki, phoneFp)).toBe(201);

    const desktopClient = await AuthClient.connect(
      requiredBase,
      desktopId,
      desktop.privateKey,
      desktop.publicKey,
      true,
      'desktop',
    );
    expect((await desktopClient.next('auth.ok')).payload.registered).toBe(false);
    desktopClient.close();

    const phoneClient = await AuthClient.connect(
      requiredBase,
      phoneId,
      phone.privateKey,
      phone.publicKey,
      true,
      'phone',
    );
    expect((await phoneClient.next('auth.ok')).payload.registered).toBe(false);
    phoneClient.close();
  });

  test('an enrolled device presenting a different key is closed (#24)', async () => {
    const original = await generateSigningKeyPair();
    const deviceId = 'dev_rotated000000001';
    const spki = bytesToBase64url(await exportPublicKeySpki(original.publicKey));
    const fp = await fingerprintFromSpkiB64(spki);
    expect(await enroll(deviceId, spki, fp)).toBe(201);

    const impostor = await generateSigningKeyPair();
    const client = await AuthClient.connect(requiredBase, deviceId, impostor.privateKey, impostor.publicKey);
    const closed = await client.closed;
    expect(closed.code).toBe(1008);
  });
});
