/**
 * Bun transport for the RemoteTab signaling service: HTTP health endpoints
 * (Hono) plus the /ws WebSocket upgrade (raw Bun.serve). All message handling
 * lives in the runtime-neutral SignalingRouter.
 */

import { MAX_SIGNALING_FRAME_BYTES, newRequestId } from '@remotetab/protocol';
import { timingSafeEqual } from '@remotetab/crypto';
import { Hono } from 'hono';
import {
  createDeviceRegistry,
  type DeviceRegistry,
  type EnrollResult,
} from './device-registry.ts';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';
import { FrameRateLimiter } from './rate-limit.ts';
import { ConnectionRegistry, MemoryPairingRepo, MemorySessionRepo } from './registry.ts';
import { SignalingRouter, WS_CLOSE_PROTOCOL_ERROR } from './router.ts';
import { isValidTurnDeviceId, mintTurnCredentials, turnIceServer } from './turn.ts';

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
  devices: DeviceRegistry;
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
  const { registry: devices, durable } = createDeviceRegistry(ctx.env.databaseUrl);
  const router = new SignalingRouter({
    registry,
    pairings,
    sessions,
    devices,
    log: ctx.log,
    nowMs: options.nowMs ?? (() => Date.now()),
    pairingTtlSeconds: options.pairingTtlSeconds ?? ctx.env.pairingTtlSeconds,
    deviceAuthMode: ctx.env.deviceAuthMode,
  });

  const sockets = new Map<string, SocketEntry>();

  const app = new Hono();

  app.get('/health/live', (c) => c.json({ status: 'live' }));

  app.get('/health/ready', (c) =>
    c.json({
      status: 'ready',
      connections: registry.size,
      deviceRegistry: durable ? 'sqlite' : 'memory',
      deviceAuthMode: ctx.env.deviceAuthMode,
    }),
  );

  const SPKI_SHAPE = /^[A-Za-z0-9_-]{20,512}$/;
  const FINGERPRINT_SHAPE = /^[A-Za-z0-9_-]{20,64}$/;

  const adminAuthorized = (c: { req: { header(name: string): string | undefined } }): boolean => {
    if (ctx.env.adminToken === '') return false;
    const header = c.req.header('authorization') ?? '';
    const expected = `Bearer ${ctx.env.adminToken}`;
    return timingSafeEqual(new TextEncoder().encode(header), new TextEncoder().encode(expected));
  };

  /**
   * Controlled device enrollment (audit issue #25): the only way a device
   * becomes known outside open-mode first-connection enrollment. Required
   * for DEVICE_AUTH=required deployments, where unknown devices cannot
   * self-enroll.
   */
  app.post('/admin/devices', async (c) => {
    if (!adminAuthorized(c)) {
      return c.json({ error: 'admin_disabled' }, ctx.env.adminToken === '' ? 404 : 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { deviceId, publicKeySpki, publicKeyFingerprint, displayName } = body as {
      deviceId?: unknown;
      publicKeySpki?: unknown;
      publicKeyFingerprint?: unknown;
      displayName?: unknown;
    };
    if (
      !isValidTurnDeviceId(deviceId) ||
      typeof publicKeySpki !== 'string' ||
      !SPKI_SHAPE.test(publicKeySpki) ||
      typeof publicKeyFingerprint !== 'string' ||
      !FINGERPRINT_SHAPE.test(publicKeyFingerprint) ||
      (displayName !== undefined && typeof displayName !== 'string')
    ) {
      return c.json({ error: 'invalid_device_identity' }, 400);
    }
    const result: EnrollResult = devices.enroll(
      deviceId,
      publicKeySpki,
      publicKeyFingerprint,
      typeof displayName === 'string' ? displayName : undefined,
    );
    ctx.log.info('admin.device_enroll', { deviceId, result });
    if (result === 'enrolled') return c.json({ status: 'enrolled' }, 201);
    if (result === 'known') return c.json({ status: 'known' }, 200);
    return c.json({ error: 'identity_conflict' }, 409);
  });

  // Short-lived TURN credentials (issue #017). Disabled unless TURN_SECRET is
  // configured. The shared secret never leaves this process.
  app.post('/turn/credentials', async (c) => {
    if (ctx.env.turnSecret === '' || ctx.env.turnUrls.length === 0) {
      return c.json({ error: 'turn_disabled' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { deviceId?: unknown };
    if (!isValidTurnDeviceId(body.deviceId)) {
      return c.json({ error: 'invalid_device_id' }, 400);
    }
    const cred = await mintTurnCredentials({
      secret: ctx.env.turnSecret,
      deviceId: body.deviceId,
      ttlSeconds: ctx.env.turnTtlSeconds,
    });
    ctx.log.info('turn.credentials', { deviceId: body.deviceId });
    return c.json({
      ttlSeconds: cred.ttlSeconds,
      username: cred.username,
      credential: cred.credential,
      iceServers: [turnIceServer(ctx.env.turnUrls, cred)],
    });
  });

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
    async message(ws, message) {
      const connId = ws.data.connId;
      const entry = connId ? sockets.get(connId) : undefined;
      if (!connId || !entry) return;
      registry.touch(connId, Date.now());
      if (!entry.limiter.allow(Date.now())) {
        entry.close(WS_CLOSE_PROTOCOL_ERROR, 'rate');
        ctx.log.warn('ws.rate_limited', { connId });
        return;
      }
      const result = await router.handleFrame(
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
    devices,
    stop: async () => {
      clearInterval(sweeper);
      for (const entry of sockets.values()) entry.close(1000, 'server-shutdown');
      sockets.clear();
      server.stop(true);
      ctx.log.info('server.stopped', {});
    },
  };
}
