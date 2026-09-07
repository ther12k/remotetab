import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  bytesToBase64url,
  encodeTranscript,
  exportPublicKeySpki,
  generateSigningKeyPair,
  importPublicKeySpki,
  keyFingerprint,
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
      this.fingerprint = await keyFingerprint(await importPublicKeySpki(spki));
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
});
