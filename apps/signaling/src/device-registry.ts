/**
 * Device registry for WS authentication and server-side revocation (#018).
 * Durable (bun:sqlite) when DATABASE_URL is set, in-memory otherwise — both
 * implement the same interface. Stores PUBLIC identity material only.
 */

import { Database } from 'bun:sqlite';

export interface DeviceRegistry {
  register(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): void;
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

export class MemoryDeviceRegistry implements DeviceRegistry {
  private readonly devices = new Map<string, DeviceRecord>();

  register(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): void {
    const existing = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      publicKeySpki,
      fingerprint,
      displayName: displayName ?? existing?.displayName,
      revokedAtMs: existing?.revokedAtMs,
    });
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

  register(
    deviceId: string,
    publicKeySpki: string,
    fingerprint: string,
    displayName?: string,
  ): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO devices (device_id, public_key_spki, fingerprint, display_name, registered_at_ms, revoked_at_ms)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(device_id) DO UPDATE SET public_key_spki = excluded.public_key_spki, fingerprint = excluded.fingerprint`,
      [deviceId, publicKeySpki, fingerprint, displayName ?? null, now],
    );
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
