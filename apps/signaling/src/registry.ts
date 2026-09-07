/**
 * Connection registry and in-memory metadata repositories.
 * These hold ROUTING METADATA ONLY — never message payloads, SDP content,
 * page data, or pairing secrets (those never reach the server at all).
 */

/** Device roles on the signaling service. */
export type DeviceRole = 'desktop' | 'phone';

/** Transport-agnostic connection handle so the router stays runtime-neutral. */
export interface SignalingConnection {
  readonly connId: string;
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export type RegisteredConnection = {
  connId: string;
  /** Set after a valid hello. */
  role: DeviceRole | null;
  deviceId: string | null;
  lastSeenMs: number;
};

export class ConnectionRegistry {
  private readonly conns = new Map<string, RegisteredConnection>();
  private readonly byDevice = new Map<string, string>();

  register(connId: string, nowMs: number): RegisteredConnection {
    const conn: RegisteredConnection = { connId, role: null, deviceId: null, lastSeenMs: nowMs };
    this.conns.set(connId, conn);
    return conn;
  }

  get(connId: string): RegisteredConnection | undefined {
    return this.conns.get(connId);
  }

  /** Bind hello identity; rejects duplicate live bindings for the same device. */
  bind(connId: string, role: DeviceRole, deviceId: string): boolean {
    const existing = this.byDevice.get(deviceId);
    if (existing !== undefined && existing !== connId && this.conns.has(existing)) {
      return false;
    }
    const conn = this.conns.get(connId);
    if (!conn) return false;
    conn.role = role;
    conn.deviceId = deviceId;
    this.byDevice.set(deviceId, connId);
    return true;
  }

  connIdForDevice(deviceId: string): string | undefined {
    return this.byDevice.get(deviceId);
  }

  touch(connId: string, nowMs: number): void {
    const conn = this.conns.get(connId);
    if (conn) conn.lastSeenMs = nowMs;
  }

  unregister(connId: string): RegisteredConnection | undefined {
    const conn = this.conns.get(connId);
    if (!conn) return undefined;
    this.conns.delete(connId);
    if (conn.deviceId && this.byDevice.get(conn.deviceId) === connId) {
      this.byDevice.delete(conn.deviceId);
    }
    return conn;
  }

  /** Collect connections silent for longer than staleMs. */
  sweep(nowMs: number, staleMs: number): string[] {
    const stale: string[] = [];
    for (const conn of this.conns.values()) {
      if (nowMs - conn.lastSeenMs > staleMs) stale.push(conn.connId);
    }
    return stale;
  }

  get size(): number {
    return this.conns.size;
  }
}

export type PairingState = 'CREATED' | 'JOINED' | 'CONSUMED' | 'EXPIRED' | 'REJECTED' | 'CANCELLED';

/**
 * Pairing metadata. Key material shown here is PUBLIC identity material only:
 * SPKI public keys and their fingerprints. The pairing SECRET never touches
 * the server.
 */
export type PairingRecord = {
  pairId: string;
  desktopConnId: string;
  desktopDeviceId: string;
  desktopDisplayName?: string;
  desktopSpki: string;
  desktopFingerprint: string;
  phoneConnId?: string;
  phoneDeviceId?: string;
  phoneDisplayName?: string;
  phoneSpki?: string;
  phoneFingerprint?: string;
  state: PairingState;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface PairingRepo {
  create(record: PairingRecord): void;
  get(pairId: string): PairingRecord | undefined;
  update(record: PairingRecord): void;
  findOpenByDesktopConn(connId: string): PairingRecord | undefined;
  /** All pairings not yet terminal (sweeping/cleanup). */
  listOpen(): PairingRecord[];
}

export class MemoryPairingRepo implements PairingRepo {
  private readonly pairings = new Map<string, PairingRecord>();

  create(record: PairingRecord): void {
    this.pairings.set(record.pairId, record);
  }

  get(pairId: string): PairingRecord | undefined {
    return this.pairings.get(pairId);
  }

  update(record: PairingRecord): void {
    this.pairings.set(record.pairId, record);
  }

  findOpenByDesktopConn(connId: string): PairingRecord | undefined {
    for (const p of this.pairings.values()) {
      if (p.desktopConnId === connId && (p.state === 'CREATED' || p.state === 'JOINED')) return p;
    }
    return undefined;
  }

  listOpen(): PairingRecord[] {
    const out: PairingRecord[] = [];
    for (const p of this.pairings.values()) {
      if (
        p.state !== 'CONSUMED' &&
        p.state !== 'EXPIRED' &&
        p.state !== 'REJECTED' &&
        p.state !== 'CANCELLED'
      ) {
        out.push(p);
      }
    }
    return out;
  }
}

export type SessionState = 'SIGNALING' | 'ACTIVE' | 'CLOSED';

export type SessionRecord = {
  sessionId: string;
  desktopDeviceId: string;
  phoneDeviceId: string;
  desktopConnId: string;
  phoneConnId: string;
  state: SessionState;
  createdAtMs: number;
};

export interface SessionRepo {
  create(record: SessionRecord): void;
  get(sessionId: string): SessionRecord | undefined;
  update(record: SessionRecord): void;
  findOpenByDevice(deviceId: string): SessionRecord | undefined;
  /** All sessions not CLOSED (cleanup on disconnect). */
  listOpen(): SessionRecord[];
}

export class MemorySessionRepo implements SessionRepo {
  private readonly sessions = new Map<string, SessionRecord>();

  create(record: SessionRecord): void {
    this.sessions.set(record.sessionId, record);
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  update(record: SessionRecord): void {
    this.sessions.set(record.sessionId, record);
  }

  findOpenByDevice(deviceId: string): SessionRecord | undefined {
    for (const s of this.sessions.values()) {
      if ((s.desktopDeviceId === deviceId || s.phoneDeviceId === deviceId) && s.state !== 'CLOSED')
        return s;
    }
    return undefined;
  }

  listOpen(): SessionRecord[] {
    const out: SessionRecord[] = [];
    for (const s of this.sessions.values()) {
      if (s.state !== 'CLOSED') out.push(s);
    }
    return out;
  }
}
