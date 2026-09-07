/**
 * Paired-device store (laptop side, issue #015). Minimal, content-free
 * metadata: public keys, fingerprints, display names, timestamps. Revocation
 * is persistent — a revoked device is excluded from peer authentication
 * until it is explicitly paired again (which clears the marker).
 */

export const PAIRED_DEVICES_KEY = 'pairedDevices';

export type PairedDevice = {
  deviceId: string;
  displayName: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  addedAtMs: number;
  /** Set when the owner revoked this device; cleared on re-pair. */
  revokedAtMs?: number;
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
      typeof v.addedAtMs === 'number' &&
      (v.revokedAtMs === undefined || typeof v.revokedAtMs === 'number')
    );
  });
}

export class PairedDeviceStore {
  constructor(private readonly area: StorageAreaLike) {}

  /** All records, including revoked ones (shown struck-through in the UI). */
  async list(): Promise<PairedDevice[]> {
    const result = await this.area.get(PAIRED_DEVICES_KEY);
    const raw = result[PAIRED_DEVICES_KEY];
    return isPairedDeviceList(raw) ? raw : [];
  }

  /** Devices allowed to authenticate: paired and not revoked. */
  async listActive(): Promise<PairedDevice[]> {
    return (await this.list()).filter((d) => d.revokedAtMs === undefined);
  }

  async findActive(deviceId: string): Promise<PairedDevice | undefined> {
    return (await this.listActive()).find((d) => d.deviceId === deviceId);
  }

  /** Pair (or re-pair): inserts/updates and clears any revocation marker. */
  async upsert(device: PairedDevice): Promise<void> {
    const list = await this.list();
    const filtered = list.filter((d) => d.deviceId !== device.deviceId);
    filtered.push(device);
    await this.area.set({ [PAIRED_DEVICES_KEY]: filtered });
  }

  /**
   * Persist revocation. The public key stays on record so a stale session
   * cannot re-authenticate and re-pairing is explicit.
   */
  async revoke(deviceId: string, nowMs: number): Promise<PairedDevice | undefined> {
    const list = await this.list();
    const device = list.find((d) => d.deviceId === deviceId);
    if (!device || device.revokedAtMs !== undefined) return undefined;
    device.revokedAtMs = nowMs;
    await this.area.set({ [PAIRED_DEVICES_KEY]: list });
    return device;
  }

  /** Phone-side "Forget" equivalent lives on the phone; this clears locally. */
  async remove(deviceId: string): Promise<void> {
    const list = await this.list();
    await this.area.set({
      [PAIRED_DEVICES_KEY]: list.filter((d) => d.deviceId !== deviceId),
    });
  }
}
