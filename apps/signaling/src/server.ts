/**
 * Bun transport for the RemoteTab signaling service: HTTP health endpoints
 * (Hono) plus the /ws WebSocket upgrade (raw Bun.serve). All message handling
 * lives in the runtime-neutral SignalingRouter.
 */

import { MAX_SIGNALING_FRAME_BYTES, newRequestId } from '@remotetab/protocol';
import { Hono } from 'hono';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';
import { FrameRateLimiter } from './rate-limit.ts';
import { ConnectionRegistry, MemoryPairingRepo, MemorySessionRepo } from './registry.ts';
import { SignalingRouter, WS_CLOSE_PROTOCOL_ERROR } from './router.ts';

const HEARTBEAT_TIMEOUT_SEC = 45;
/** Per-connection signaling frame budget. */
const MAX_FRAMES_PER_10S = 120;

type SocketEntry = {
  send(frame: string): void;
  close(code: number, reason: string): void;
  limiter: FrameRateLimiter;
};

export type ServerHandle = {
  port: number;
  stop(): Promise<void>;
  registry: ConnectionRegistry;
  router: SignalingRouter;
};

export type ServerOptions = {
  /** Test hook: deterministic clock for the stale sweep. */
  nowMs?: () => number;
  pairingTtlSeconds?: number;
};

export function startServer(
  ctx: { env: Env; log: Logger },
  options: ServerOptions = {},
): ServerHandle {
  const registry = new ConnectionRegistry();
  const pairings = new MemoryPairingRepo();
  const sessions = new MemorySessionRepo();
  const router = new SignalingRouter({
    registry,
    pairings,
    sessions,
    log: ctx.log,
    nowMs: options.nowMs ?? (() => Date.now()),
    pairingTtlSeconds: options.pairingTtlSeconds ?? ctx.env.pairingTtlSeconds,
  });

  const sockets = new Map<string, SocketEntry>();

  const app = new Hono();

  app.get('/health/live', (c) => c.json({ status: 'live' }));

  app.get('/health/ready', (c) => c.json({ status: 'ready', connections: registry.size }));

  app.onError((err, c) => {
    ctx.log.error('http.error', { path: c.req.path, error: err.message });
    return c.json({ error: 'internal' }, 500);
  });

  type WsMeta = { connId: string | null };

  const websocket: Bun.WebSocketHandler<WsMeta> = {
    maxPayloadLength: MAX_SIGNALING_FRAME_BYTES,
    perMessageDeflate: false,
    open(ws) {
      const connId = newRequestId();
      ws.data.connId = connId;
      registry.register(connId, Date.now());
      const handle: SocketEntry = {
        limiter: new FrameRateLimiter(MAX_FRAMES_PER_10S, 10_000),
        send: (frame: string) => {
          try {
            ws.send(frame);
          } catch {
            ctx.log.warn('ws.send_failed', { connId });
          }
        },
        close: (code: number, reason: string) => ws.close(code, reason),
      };
      sockets.set(connId, handle);
      router.bindHandle({ connId, send: handle.send, close: handle.close });
      ctx.log.debug('ws.open', { connId });
    },
    message(ws, message) {
      const connId = ws.data.connId;
      const entry = connId ? sockets.get(connId) : undefined;
      if (!connId || !entry) return;
      registry.touch(connId, Date.now());
      if (!entry.limiter.allow(Date.now())) {
        entry.close(WS_CLOSE_PROTOCOL_ERROR, 'rate');
        ctx.log.warn('ws.rate_limited', { connId });
        return;
      }
      const result = router.handleFrame(
        { connId, send: entry.send, close: entry.close },
        String(message),
      );
      if (result.fatal) {
        entry.close(result.code ?? WS_CLOSE_PROTOCOL_ERROR, 'protocol');
      }
    },
    close(ws) {
      const connId = ws.data.connId;
      if (!connId) return;
      sockets.delete(connId);
      router.handleConnClosed(connId);
      ctx.log.debug('ws.close', { connId });
    },
  };

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = async (req: Request): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return app.fetch(req);
    // Origin validation: enforced whenever ALLOWED_ORIGINS is configured.
    const origin = req.headers.get('Origin');
    if (
      ctx.env.allowedOrigins.length > 0 &&
      (origin === null || !ctx.env.allowedOrigins.includes(origin))
    ) {
      ctx.log.warn('ws.origin_rejected', {});
      return json({ error: 'origin_not_allowed' }, 403);
    }
    const upgraded = server.upgrade(req, { data: { connId: null } });
    if (upgraded) return undefined;
    return json({ error: 'upgrade_failed' }, 400);
  };

  const server = Bun.serve<WsMeta>({
    port: ctx.env.port,
    fetch,
    websocket,
  });

  // Heartbeat eviction: drop sockets that have gone silent.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const connId of registry.sweep(now, HEARTBEAT_TIMEOUT_SEC * 1000)) {
      ctx.log.info('ws.stale_evicted', { connId });
      sockets.get(connId)?.close(WS_CLOSE_PROTOCOL_ERROR, 'stale');
      registry.unregister(connId);
      router.handleConnClosed(connId);
    }
  }, 5_000);
  sweeper.unref?.();

  return {
    port: server.port ?? ctx.env.port,
    registry,
    router,
    stop: async () => {
      clearInterval(sweeper);
      for (const entry of sockets.values()) entry.close(1000, 'server-shutdown');
      sockets.clear();
      server.stop(true);
      ctx.log.info('server.stopped', {});
    },
  };
}
