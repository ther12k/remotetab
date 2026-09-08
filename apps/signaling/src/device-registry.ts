/**
 * Device registry for WS authentication and server-side revocation (#018).
 * Durable (bun:sqlite) when DATABASE_URL is set, in-memory otherwise — both
 * implement the same interface. Stores PUBLIC identity material only.
 *
 * Identity continuity (audit issue #24): enrollment is INSERT-only. An
 * existing device's key is never replaced — a connection either presents the
 * exact registered identity or authentication fails. This keeps the proof
 * "I possess the key this deviceId registered" meaningful even when the
 * signaling service is hostile.
 */

import { Database } from 'bun:sqlite';

export type EnrollResult = 'enrolled' | 'known' | 'conflict';

export interface DeviceRegistry {
  /**
   * Insert a device identity. Never overwrites an existing key: a matching
   * identity returns 'known', a different key for the same deviceId returns
   * 'conflict' and leaves the stored identity untouched.
   */
  enroll(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): EnrollResult;
  get(
    deviceId: string,
  ): { publicKeySpki: string; fingerprint: string; revokedAtMs?: number } | undefined;
  isRevoked(deviceId: string): boolean;
  revoke(deviceId: string, nowMs: number): boolean;
}

type DeviceRecord = {
  publicKeySpki: string;
  fingerprint: string;
  displayName?: string;
  revokedAtMs?: number;
};

function compareEnroll(
  existing: DeviceRecord | undefined,
  publicKeySpki: string,
  fingerprint: string,
): EnrollResult | null {
  if (!existing) return null; // caller inserts
  return existing.publicKeySpki === publicKeySpki && existing.fingerprint === fingerprint
    ? 'known'
    : 'conflict';
}

export class MemoryDeviceRegistry implements DeviceRegistry {
  private readonly devices = new Map<string, DeviceRecord>();

  enroll(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): EnrollResult {
    const existing = this.devices.get(deviceId);
    const verdict = compareEnroll(existing, publicKeySpki, fingerprint);
    if (verdict) return verdict;
    this.devices.set(deviceId, { publicKeySpki, fingerprint, displayName });
    return 'enrolled';
  }

  get(deviceId: string): DeviceRecord | undefined {
    return this.devices.get(deviceId);
  }

  isRevoked(deviceId: string): boolean {
    return (this.devices.get(deviceId)?.revokedAtMs ?? undefined) !== undefined;
  }

  revoke(deviceId: string, nowMs: number): boolean {
    const existing = this.devices.get(deviceId);
    if (!existing || existing.revokedAtMs !== undefined) return false;
    existing.revokedAtMs = nowMs;
    return true;
  }
}

/** Durable registry over bun:sqlite (single instance). */
export class SqliteDeviceRegistry implements DeviceRegistry {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        public_key_spki TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        display_name TEXT,
        registered_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER
      )
    `);
  }

  enroll(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): EnrollResult {
    const existing = this.get(deviceId);
    const verdict = compareEnroll(existing, publicKeySpki, fingerprint);
    if (verdict) return verdict;
    this.db.run(
      `INSERT INTO devices (device_id, public_key_spki, fingerprint, display_name, registered_at_ms, revoked_at_ms)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [deviceId, publicKeySpki, fingerprint, displayName ?? null, Date.now()],
    );
    return 'enrolled';
  }

  get(
    deviceId: string,
  ): { publicKeySpki: string; fingerprint: string; revokedAtMs?: number } | undefined {
    const row = this.db
      .query(`SELECT public_key_spki, fingerprint, revoked_at_ms FROM devices WHERE device_id = ?`)
      .get(deviceId) as
      | { public_key_spki: string; fingerprint: string; revoked_at_ms: number | null }
      | undefined;
    if (!row) return undefined;
    return {
      publicKeySpki: row.public_key_spki,
      fingerprint: row.fingerprint,
      revokedAtMs: row.revoked_at_ms ?? undefined,
    };
  }

  isRevoked(deviceId: string): boolean {
    const row = this.get(deviceId);
    return row?.revokedAtMs !== undefined;
  }

  revoke(deviceId: string, nowMs: number): boolean {
    const existing = this.get(deviceId);
    if (!existing || existing.revokedAtMs !== undefined) return false;
    this.db.run(`UPDATE devices SET revoked_at_ms = ? WHERE device_id = ?`, [nowMs, deviceId]);
    return true;
  }
}

export function createDeviceRegistry(databaseUrl: string | undefined): {
  registry: DeviceRegistry;
  durable: boolean;
} {
  if (databaseUrl && databaseUrl.length > 0) {
    return { registry: new SqliteDeviceRegistry(databaseUrl), durable: true };
  }
  return { registry: new MemoryDeviceRegistry(), durable: false };
}
