/** Environment parsing with safe defaults. Secrets never leave the server. */

export type Env = {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  pairingTtlSeconds: number;
  reconnectTtlSeconds: number;
  /** Allowed browser origins for WS upgrade; empty = allow all (dev only). */
  allowedOrigins: string[];
  /** coturn shared secret — NEVER sent to clients. Empty disables the endpoint. */
  turnSecret: string;
  /** TURN URL list advertised to clients, e.g. turn:turn.example.com:3478 */
  turnUrls: string[];
  /** Credential lifetime in seconds. */
  turnTtlSeconds: number;
  /** 'required' closes sockets that fail device auth; 'open' only warns. */
  deviceAuthMode: 'open' | 'required';
  /** sqlite path for the durable device registry; empty = in-memory. */
  databaseUrl: string;
  /** Bearer token for the admin revoke endpoint; empty disables it. */
  adminToken: string;
};

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseEnv(env: Record<string, string | undefined> = process.env): Env {
  const logLevel = env.LOG_LEVEL;
  return {
    port: int(env.PORT, 8787),
    logLevel:
      logLevel === 'debug' || logLevel === 'warn' || logLevel === 'error' ? logLevel : 'info',
    pairingTtlSeconds: int(env.PAIRING_TTL_SECONDS, 300),
    reconnectTtlSeconds: int(env.RECONNECT_TTL_SECONDS, 60),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnSecret: env.TURN_SECRET ?? '',
    turnUrls: (env.TURN_URLS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('turn:') || s.startsWith('turns:')),
    turnTtlSeconds: int(env.TURN_TTL_SECONDS, 600),
    deviceAuthMode: env.DEVICE_AUTH === 'required' ? 'required' : 'open',
    databaseUrl: env.DATABASE_URL ?? '',
    adminToken: env.ADMIN_TOKEN ?? '',
  };
}
