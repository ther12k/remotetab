import { describe, expect, it } from 'vitest';
import { PairedDeviceStore } from './paired-devices.ts';

function fakeArea() {
  const data = new Map<string, unknown>();
  return {
    async get(key: string) {
      const v = data.get(key);
      return { [key]: v === undefined ? undefined : structuredClone(v) };
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
  };
}

const DEVICE = {
  deviceId: 'dev_phone000000000000000000001',
  displayName: 'Pixel',
  publicKeySpki: 'AAAApublicKeyAAAA',
  publicKeyFingerprint: 'fpPhoneAAAAAAAA',
  addedAtMs: 1_000,
};

describe('PairedDeviceStore', () => {
  it('starts empty and upserts a device', async () => {
    const store = new PairedDeviceStore(fakeArea());
    expect(await store.list()).toEqual([]);
    await store.upsert(DEVICE);
    expect((await store.listActive())[0]?.deviceId).toBe(DEVICE.deviceId);
  });

  it('upsert clears a revocation marker on re-pair', async () => {
    const store = new PairedDeviceStore(fakeArea());
    await store.upsert(DEVICE);
    await store.revoke(DEVICE.deviceId, 2_000);
    expect(await store.findActive(DEVICE.deviceId)).toBeUndefined();
    await store.upsert(DEVICE);
    expect((await store.findActive(DEVICE.deviceId))?.deviceId).toBe(DEVICE.deviceId);
    const record = (await store.list())[0];
    expect(record?.revokedAtMs).toBeUndefined();
  });

  it('revoke persists a marker; revoked devices cannot authenticate', async () => {
    const store = new PairedDeviceStore(fakeArea());
    await store.upsert(DEVICE);
    const revoked = await store.revoke(DEVICE.deviceId, 5_000);
    expect(revoked?.revokedAtMs).toBe(5_000);
    expect(await store.findActive(DEVICE.deviceId)).toBeUndefined();
    expect(await store.listActive()).toEqual([]);
    expect((await store.list())[0]?.revokedAtMs).toBe(5_000); // persisted
  });

  it('revoke of an unknown or already-revoked device is a no-op', async () => {
    const store = new PairedDeviceStore(fakeArea());
    expect(await store.revoke('dev_unknown000000000000000001', 1)).toBeUndefined();
    await store.upsert(DEVICE);
    expect(await store.revoke(DEVICE.deviceId, 1_000)).toBeDefined();
    expect(await store.revoke(DEVICE.deviceId, 2_000)).toBeUndefined();
    expect((await store.list())[0]?.revokedAtMs).toBe(1_000);
  });

  it('remove deletes the record entirely', async () => {
    const store = new PairedDeviceStore(fakeArea());
    await store.upsert(DEVICE);
    await store.remove(DEVICE.deviceId);
    expect(await store.list()).toEqual([]);
  });
});
