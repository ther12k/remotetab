/** Environment parsing with safe defaults. Secrets never leave the server. */

export type Env = {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  pairingTtlSeconds: number;
  reconnectTtlSeconds: number;
  /** Allowed browser origins for WS upgrade; empty = allow all (dev only). */
  allowedOrigins: string[];
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
  };
}
