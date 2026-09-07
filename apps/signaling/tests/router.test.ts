import { describe, expect, test } from 'bun:test';
import { MAX_SIGNALING_FRAME_BYTES, newSessionId } from '@remotetab/protocol';
import { MemoryDeviceRegistry } from '../src/device-registry.ts';
import { noopLogger } from '../src/logger.ts';
import { ConnectionRegistry, MemoryPairingRepo, MemorySessionRepo } from '../src/registry.ts';
import { SignalingRouter } from '../src/router.ts';

function makeRouter() {
  return new SignalingRouter({
    registry: new ConnectionRegistry(),
    pairings: new MemoryPairingRepo(),
    sessions: new MemorySessionRepo(),
    devices: new MemoryDeviceRegistry(),
    log: noopLogger,
    nowMs: () => 1_000,
    pairingTtlSeconds: 300,
    deviceAuthMode: 'open',
  });
}

function fakeConn(connId: string) {
  return {
    connId,
    sent: [] as string[],
    closed: [] as number[],
    send(frame: string) {
      this.sent.push(frame);
    },
    close(code: number) {
      this.closed.push(code);
    },
  };
}

describe('router-level guards', () => {
  test('oversized frames return MESSAGE_TOO_LARGE before JSON parsing', async () => {
    const router = makeRouter();
    const conn = fakeConn('conn_oversize00000000001');
    router.bindHandle(conn);
    const raw = `{"pad":"${'a'.repeat(MAX_SIGNALING_FRAME_BYTES + 1)}"}`;
    const result = await router.handleFrame(conn, raw);
    expect(result.fatal).toBe(true);
    const frame = JSON.parse(conn.sent[0] ?? '{}') as { payload: { code: string } };
    expect(frame.payload.code).toBe('MESSAGE_TOO_LARGE');
  });

  test('device identity may not be re-bound on the same socket', async () => {
    const router = makeRouter();
    const conn = fakeConn('conn_rebind000000000001');
    router.bindHandle(conn);
    router.handleFrame(
      conn,
      JSON.stringify({
        v: 1,
        type: 'hello',
        payload: { role: 'phone', deviceId: 'dev_a00000000000000000001' },
      }),
    );
    const second = await router.handleFrame(
      conn,
      JSON.stringify({
        v: 1,
        type: 'hello',
        payload: { role: 'desktop', deviceId: 'dev_b00000000000000000001' },
      }),
    );
    expect(second.fatal).toBe(true);
  });

  test('an expired pairing join yields PAIR_EXPIRED without closing', async () => {
    const registry = new ConnectionRegistry();
    const pairings = new MemoryPairingRepo();
    const now = 10_000;
    const router = new SignalingRouter({
      registry,
      pairings,
      sessions: new MemorySessionRepo(),
      devices: new MemoryDeviceRegistry(),
      log: noopLogger,
      nowMs: () => now,
      pairingTtlSeconds: 300,
      deviceAuthMode: 'open',
    });
    registry.register('conn_desktop00000000001', now);
    registry.bind('conn_desktop00000000001', 'desktop', 'dev_desktop0000000000000000001');
    const pairId = newSessionId(); // shape-valid id
    pairings.create({
      pairId,
      desktopConnId: 'conn_desktop00000000001',
      desktopDeviceId: 'dev_desktop0000000000000000001',
      desktopSpki: 'AAAABBBBCCCC',
      desktopFingerprint: 'fpAAAA',
      state: 'CREATED',
      createdAtMs: now - 400_000,
      expiresAtMs: now - 100_000,
    });
    const conn = fakeConn('conn_phone00000000000001');
    router.bindHandle(conn);
    registry.register('conn_phone00000000000001', now);
    router.handleFrame(
      conn,
      JSON.stringify({
        v: 1,
        type: 'hello',
        payload: { role: 'phone', deviceId: 'dev_phone000000000000000000001' },
      }),
    );
    const result = await router.handleFrame(
      conn,
      JSON.stringify({
        v: 1,
        id: 'req_join0000000000000000001',
        type: 'pair.join',
        payload: {
          pairId,
          deviceId: 'dev_phone000000000000000000001',
          publicKeySpki: 'CCCCDDDD',
          publicKeyFingerprint: 'fpBBBB',
          pairingProof: 'proof',
        },
      }),
    );
    expect(result.fatal).toBe(false);
    const errorFrame = conn.sent
      .map((s) => JSON.parse(s) as { type: string; payload?: { code?: string } })
      .find((f) => f.type === 'error');
    expect(errorFrame?.payload?.code).toBe('PAIR_EXPIRED');
  });
});
