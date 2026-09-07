/**
 * Device identity persistence. Issue #007 creates the stable deviceId only;
 * the P-256 signing key and fingerprint arrive with pairing (#013).
 */

import { newDeviceId } from '@remotetab/protocol';

export const DEVICE_KEY = 'device';

export type DeviceIdentity = {
  deviceId: string;
  displayName: string;
};

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isValidIdentity(value: unknown): value is DeviceIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === 'string' && v.deviceId.length >= 8 && typeof v.displayName === 'string'
  );
}

export class DeviceIdentityStore {
  constructor(private readonly area: StorageAreaLike) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const result = await this.area.get(DEVICE_KEY);
    const raw = result[DEVICE_KEY];
    if (isValidIdentity(raw)) return raw;
    const identity: DeviceIdentity = {
      deviceId: newDeviceId(),
      displayName: 'This laptop',
    };
    await this.area.set({ [DEVICE_KEY]: identity });
    return identity;
  }
}
