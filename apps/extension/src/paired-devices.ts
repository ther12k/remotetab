/**
 * Paired-device store (laptop side). Minimal, content-free metadata only:
 * public keys, fingerprints, display names, timestamps. Full list/revoke UX
 * arrives with issue #015.
 */

export const PAIRED_DEVICES_KEY = 'pairedDevices';

export type PairedDevice = {
  deviceId: string;
  displayName: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  addedAtMs: number;
};

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function isPairedDeviceList(value: unknown): value is PairedDevice[] {
  if (!Array.isArray(value)) return false;
  return value.every((d) => {
    if (typeof d !== 'object' || d === null) return false;
    const v = d as Record<string, unknown>;
    return (
      typeof v.deviceId === 'string' &&
      typeof v.displayName === 'string' &&
      typeof v.publicKeySpki === 'string' &&
      typeof v.publicKeyFingerprint === 'string' &&
      typeof v.addedAtMs === 'number'
    );
  });
}

export class PairedDeviceStore {
  constructor(private readonly area: StorageAreaLike) {}

  async list(): Promise<PairedDevice[]> {
    const result = await this.area.get(PAIRED_DEVICES_KEY);
    const raw = result[PAIRED_DEVICES_KEY];
    return isPairedDeviceList(raw) ? raw : [];
  }

  async upsert(device: PairedDevice): Promise<void> {
    const list = await this.list();
    const filtered = list.filter((d) => d.deviceId !== device.deviceId);
    filtered.push(device);
    await this.area.set({ [PAIRED_DEVICES_KEY]: filtered });
  }
}
