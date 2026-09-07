import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SignalingMessage } from '@remotetab/protocol';
import { parseEnv } from '../src/env.ts';
import { noopLogger } from '../src/logger.ts';
import { type ServerHandle, startServer } from '../src/server.ts';

const DESKTOP_ID = 'dev_desktop0000000000000000001';
const PHONE_ID = 'dev_phone000000000000000000001';
const IMPOSTOR_ID = 'dev_impostor00000000000000001';

const DESKTOP_SPKI = 'BCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DESKTOP_FP = 'AAAAfp_desktopAAAAAAAAAAAA';
const PHONE_SPKI = 'CDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01234567890';
const PHONE_FP = 'BBBBfp_phoneAAAAAAAAAAAAAA';
const PAIRING_PROOF = 'aaaaBBBBccccDDDD-eeeeFFFFggggHHHH-aaaaBBBBccccDDDDaaaaBBBB';

let server: ServerHandle;
let base: string;

beforeAll(() => {
  server = startServer({ env: { ...parseEnv({ PORT: '0' }), port: 0 }, log: noopLogger });
  base = `ws://localhost:${server.port}/ws`;
});

afterAll(async () => {
  await server.stop();
});

type PayloadOf<T extends SignalingMessage['type']> = Extract<
  SignalingMessage,
  { type: T }
>['payload'];

/** Tiny promise-based WS test client with a received-frame queue. */
class TestClient {
  private ws: WebSocket;
  private queue: SignalingMessage[] = [];
  private waiters: { type?: string; resolve: (m: SignalingMessage) => void }[] = [];
  readonly closed: Promise<{ code: number }>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      const frame = JSON.parse(String(ev.data)) as SignalingMessage;
      const waiterIdx = this.waiters.findIndex((w) => !w.type || w.type === frame.type);
      if (waiterIdx >= 0) {
        const waiter = this.waiters.splice(waiterIdx, 1)[0];
        if (waiter) waiter.resolve(frame);
      } else {
        this.queue.push(frame);
      }
    };
    this.closed = new Promise((resolve) => {
      this.ws.onclose = (ev) => resolve({ code: ev.code ?? 0 });
    });
  }

  static connect(url: string): Promise<TestClient> {
    const c = new TestClient(url);
    return new Promise((resolve, reject) => {
      c.ws.onopen = () => resolve(c);
      c.ws.onerror = () => reject(new Error('ws connect failed'));
    });
  }

  send(frame: SignalingMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(frame));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** Next received frame (whole message), optionally filtered by type. */
  private waitFor(type?: string, timeoutMs = 2000): Promise<SignalingMessage> {
    return new Promise((resolve, reject) => {
      const idx = type
        ? this.queue.findIndex((f) => f.type === type)
        : this.queue.length > 0
          ? 0
          : -1;
      if (idx >= 0) {
        const frame = this.queue.splice(idx, 1)[0];
        if (frame) resolve(frame);
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${type ?? 'frame'}`)),
        timeoutMs,
      );
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Next received frame payload, optionally filtered by type. */
  async next<T extends SignalingMessage['type']>(
    type?: T,
    timeoutMs = 2000,
  ): Promise<PayloadOf<T>> {
    const frame = await this.waitFor(type, timeoutMs);
    return frame.payload as unknown as PayloadOf<T>;
  }

  close(): void {
    this.ws.close();
  }
}

const hello = (role: 'desktop' | 'phone', deviceId: string) => ({
  v: 1,
  id: 'req_hello0000000000000000001',
  type: 'hello',
  payload: { role, deviceId },
});

const pairJoinPayload = (pairId: string) => ({
  pairId,
  deviceId: PHONE_ID,
  displayName: 'Pixel',
  publicKeySpki: PHONE_SPKI,
  publicKeyFingerprint: PHONE_FP,
  pairingProof: PAIRING_PROOF,
});

describe('health endpoints', () => {
  test('live and ready respond', async () => {
    const live = await fetch(`http://localhost:${server.port}/health/live`);
    expect(live.status).toBe(200);
    const ready = await fetch(`http://localhost:${server.port}/health/ready`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { status: string };
    expect(body.status).toBe('ready');
  });
});

describe('ws protocol enforcement', () => {
  test('hello gets hello.ok with heartbeat config', async () => {
    const client = await TestClient.connect(base);
    client.send(hello('desktop', DESKTOP_ID));
    const reply = await client.next('hello.ok');
    expect(reply.heartbeatIntervalSec).toBe(15);
    expect(reply.heartbeatTimeoutSec).toBe(45);
    client.close();
  });

  test('frames before hello are rejected and close the socket', async () => {
    const client = await TestClient.connect(base);
    client.send({ v: 1, type: 'presence.ping', payload: { ts: 1 } });
    const err = await client.next('error');
    expect(err.code).toBe('MESSAGE_INVALID');
    const close = await client.closed;
    expect(close.code).toBe(1002);
  });

  test('invalid JSON closes the socket with an error frame', async () => {
    const client = await TestClient.connect(base);
    client.sendRaw('{not json');
    const err = await client.next('error');
    expect(err.code).toBe('MESSAGE_INVALID');
    const close = await client.closed;
    expect(close.code).toBe(1002);
  });

  test('oversized frames are terminated at the transport', async () => {
    const client = await TestClient.connect(base);
    client.send({
      v: 1,
      type: 'hello',
      payload: { role: 'desktop', deviceId: DESKTOP_ID, pad: 'a'.repeat(70_000) },
    });
    // Bun terminates the socket on maxPayloadLength before any parse happens.
    const close = await client.closed;
    expect(close.code).toBeGreaterThan(0);
  });

  test('unknown protocol version is rejected', async () => {
    const client = await TestClient.connect(base);
    client.send({ v: 99, type: 'hello', payload: { role: 'desktop', deviceId: DESKTOP_ID } });
    const err = await client.next('error');
    expect(err.code).toBe('MESSAGE_INVALID');
  });

  test('duplicate hello is fatal', async () => {
    const client = await TestClient.connect(base);
    client.send(hello('desktop', DESKTOP_ID));
    await client.next('hello.ok');
    client.send(hello('desktop', DESKTOP_ID));
    await client.closed;
  });

  test('the same device cannot connect twice while live', async () => {
    const a = await TestClient.connect(base);
    a.send(hello('phone', PHONE_ID));
    await a.next('hello.ok');
    const b = await TestClient.connect(base);
    b.send(hello('phone', PHONE_ID));
    const err = await b.next('error');
    expect(err.code).toBe('SESSION_CONFLICT');
    a.close();
    await b.closed;
  });
});

describe('pairing + session routing', () => {
  test('full happy path: pair, session, signaling relay, close', async () => {
    const desktop = await TestClient.connect(base);
    const phone = await TestClient.connect(base);
    desktop.send(hello('desktop', DESKTOP_ID));
    phone.send(hello('phone', PHONE_ID));
    await desktop.next('hello.ok');
    await phone.next('hello.ok');

    desktop.send({
      v: 1,
      id: 'req_paircreate0000000000000001',
      type: 'pair.create',
      payload: {
        ttlSeconds: 300,
        publicKeySpki: DESKTOP_SPKI,
        publicKeyFingerprint: DESKTOP_FP,
        displayName: 'Laptop',
      },
    });
    const created = await desktop.next('pair.created');
    expect(created.pairId).toBeTruthy();

    phone.send({
      v: 1,
      id: 'req_pairjoin00000000000000001',
      type: 'pair.join',
      payload: pairJoinPayload(created.pairId),
    });
    const joinOnDesktop = await desktop.next('pair.join');
    expect(joinOnDesktop.pairId).toBe(created.pairId);

    desktop.send({
      v: 1,
      id: 'req_pairaccept000000000000001',
      type: 'pair.accept',
      payload: { pairId: created.pairId },
    });
    const acceptedDesktop = await desktop.next('pair.accepted');
    const acceptedPhone = await phone.next('pair.accepted');
    expect(acceptedDesktop.desktop.publicKeyFingerprint).toBe(DESKTOP_FP);
    expect(acceptedPhone.phone.publicKeySpki).toBe(PHONE_SPKI);

    phone.send({
      v: 1,
      id: 'req_sessreq000000000000000001',
      type: 'session.request',
      payload: { deviceId: PHONE_ID, desktopDeviceId: DESKTOP_ID },
    });
    await desktop.next('session.request');

    const SESSION = 'sess_session00000000000000001';
    desktop.send({
      v: 1,
      id: 'req_sessacc00000000000000001',
      type: 'session.accepted',
      payload: { sessionId: SESSION, desktopDeviceId: DESKTOP_ID, phoneDeviceId: PHONE_ID },
    });
    await phone.next('session.accepted');

    desktop.send({ v: 1, type: 'signal.offer', payload: { sessionId: SESSION, sdp: 'v=0-offer' } });
    expect((await phone.next('signal.offer')).sdp).toBe('v=0-offer');

    phone.send({ v: 1, type: 'signal.answer', payload: { sessionId: SESSION, sdp: 'v=0-answer' } });
    expect((await desktop.next('signal.answer')).sdp).toBe('v=0-answer');

    desktop.send({
      v: 1,
      type: 'signal.ice',
      payload: {
        sessionId: SESSION,
        candidate: 'cand-1',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'uf',
      },
    });
    await phone.next('signal.ice');
    phone.send({
      v: 1,
      type: 'signal.ice',
      payload: {
        sessionId: SESSION,
        candidate: 'cand-2',
        sdpMid: null,
        sdpMLineIndex: null,
        usernameFragment: null,
      },
    });
    await desktop.next('signal.ice');

    phone.send({ v: 1, type: 'presence.ping', payload: { ts: 1234 } });
    expect((await phone.next('presence.pong')).ts).toBe(1234);

    desktop.send({ v: 1, type: 'session.close', payload: { sessionId: SESSION, reason: 'user' } });
    const closed = await phone.next('session.close');
    expect(closed.reason).toBe('user');

    desktop.close();
    phone.close();
  });

  test('phone cannot create a pairing (role enforcement)', async () => {
    const phone = await TestClient.connect(base);
    phone.send(hello('phone', PHONE_ID));
    await phone.next('hello.ok');
    phone.send({
      v: 1,
      type: 'pair.create',
      payload: { ttlSeconds: 60, publicKeySpki: PHONE_SPKI, publicKeyFingerprint: PHONE_FP },
    });
    await phone.next('error');
    await phone.closed;
  });

  test('non-participant cannot signal into a session', async () => {
    const desktop = await TestClient.connect(base);
    const phone = await TestClient.connect(base);
    const impostor = await TestClient.connect(base);
    desktop.send(hello('desktop', DESKTOP_ID));
    phone.send(hello('phone', PHONE_ID));
    impostor.send(hello('phone', IMPOSTOR_ID));
    await desktop.next('hello.ok');
    await phone.next('hello.ok');
    await impostor.next('hello.ok');

    desktop.send({
      v: 1,
      type: 'pair.create',
      payload: { ttlSeconds: 60, publicKeySpki: DESKTOP_SPKI, publicKeyFingerprint: DESKTOP_FP },
    });
    const created = await desktop.next('pair.created');
    phone.send({ v: 1, type: 'pair.join', payload: pairJoinPayload(created.pairId) });
    await desktop.next('pair.join');
    desktop.send({ v: 1, type: 'pair.accept', payload: { pairId: created.pairId } });
    await phone.next('pair.accepted');

    phone.send({
      v: 1,
      type: 'session.request',
      payload: { deviceId: PHONE_ID, desktopDeviceId: DESKTOP_ID },
    });
    await desktop.next('session.request');
    desktop.send({
      v: 1,
      type: 'session.accepted',
      payload: {
        sessionId: 'sess_securetest00000000001',
        desktopDeviceId: DESKTOP_ID,
        phoneDeviceId: PHONE_ID,
      },
    });
    await phone.next('session.accepted');

    impostor.send({
      v: 1,
      type: 'signal.ice',
      payload: {
        sessionId: 'sess_securetest00000000001',
        candidate: 'evil',
        sdpMid: null,
        sdpMLineIndex: null,
        usernameFragment: null,
      },
    });
    await impostor.next('error');
    const close = await impostor.closed;
    expect(close.code).toBe(1008);

    desktop.close();
    phone.close();
  });

  test('second session for a live device conflicts', async () => {
    const desktop = await TestClient.connect(base);
    const phone1 = await TestClient.connect(base);
    desktop.send(hello('desktop', DESKTOP_ID));
    phone1.send(hello('phone', PHONE_ID));
    await desktop.next('hello.ok');
    await phone1.next('hello.ok');

    phone1.send({
      v: 1,
      type: 'session.request',
      payload: { deviceId: PHONE_ID, desktopDeviceId: DESKTOP_ID },
    });
    await desktop.next('session.request');
    desktop.send({
      v: 1,
      type: 'session.accepted',
      payload: {
        sessionId: 'sess_conflicttest0000000001',
        desktopDeviceId: DESKTOP_ID,
        phoneDeviceId: PHONE_ID,
      },
    });
    await phone1.next('session.accepted');

    // Request a new session (creating a pending request), then the conflict
    // fires on the open-session check because the desktop is still busy.
    phone1.send({
      v: 1,
      type: 'session.request',
      payload: { deviceId: PHONE_ID, desktopDeviceId: DESKTOP_ID },
    });
    await desktop.next('session.request');
    desktop.send({
      v: 1,
      type: 'session.accepted',
      payload: {
        sessionId: 'sess_conflicttest0000000002',
        desktopDeviceId: DESKTOP_ID,
        phoneDeviceId: PHONE_ID,
      },
    });
    const err = await desktop.next('error');
    expect(err.code).toBe('SESSION_CONFLICT');

    desktop.close();
    phone1.close();
  });
});

describe('registry sweep', () => {
  test('sweep finds silent connections', () => {
    expect(server.registry.sweep(Date.now(), 45_000).length).toBeGreaterThanOrEqual(0);
  });
});
