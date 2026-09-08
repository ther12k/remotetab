/**
 * Runtime-neutral signaling message router. Handles every validated inbound
 * signaling frame. The router sees message TYPES and routing ids only —
 * payload bodies (SDP/ICE) are relayed opaquely and are never logged or
 * persisted.
 *
 * Authorization model (skeleton; #013/#014/#018 build on it):
 *  - `hello` must be the first frame and binds role+deviceId;
 *  - only the desktop of a pairing may accept/reject it;
 *  - session requests are answered only by the requested desktop;
 *  - signal.offer is desktop-only, signal.answer is phone-only;
 *  - one open session per device (MVP concurrency, ADR-009).
 */

import {
  base64urlToBytes,
  bytesToBase64url,
  encodeTranscript,
  fingerprintFromSpkiB64,
  importPublicKeySpki,
} from '@remotetab/crypto';
import {
  decodeSignalingFrame,
  type ErrorCode,
  newPairId,
  newRequestId,
  type SignalingMessage,
  signalingErrorFrame,
  signalingFrame,
  WS_AUTH_DOMAIN,
} from '@remotetab/protocol';
import type { DeviceRegistry } from './device-registry.ts';
import type { Logger } from './logger.ts';
import type {
  ConnectionRegistry,
  PairingRepo,
  SessionRepo,
  SignalingConnection,
} from './registry.ts';

export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_PROTOCOL_ERROR = 1002;
export const WS_CLOSE_POLICY = 1008;

export type DeviceAuthMode = 'open' | 'required';

export type RouterDeps = {
  registry: ConnectionRegistry;
  pairings: PairingRepo;
  sessions: SessionRepo;
  devices: DeviceRegistry;
  log: Logger;
  nowMs: () => number;
  pairingTtlSeconds: number;
  deviceAuthMode: DeviceAuthMode;
};

const WS_SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;
const MAX_AUTH_FAILURES = 5;

export type InboundResult = {
  /** true when the connection must be closed after this frame. */
  fatal: boolean;
  code?: number;
};

const OK: InboundResult = { fatal: false };
const FATAL = (code: number): InboundResult => ({ fatal: true, code });

type SessionRequest = {
  phoneConnId: string;
  frame: Extract<SignalingMessage, { type: 'session.request' }>;
};

export class SignalingRouter {
  private readonly handles = new Map<string, SignalingConnection>();
  private readonly sessionRequests = new Map<string, SessionRequest>();
  private readonly authenticated = new Set<string>();
  private readonly pendingAuth = new Map<string, { nonce: string; failures: number }>();

  constructor(private readonly deps: RouterDeps) {}

  /** Register the transport handle for a connId so the router can send to it. */
  bindHandle(handle: SignalingConnection): void {
    this.handles.set(handle.connId, handle);
  }

  private send(connId: string, frame: SignalingMessage | string): void {
    const handle = this.handles.get(connId);
    if (handle) handle.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  private sendError(
    conn: SignalingConnection,
    code: ErrorCode,
    reason: string | undefined,
    replyTo?: string,
  ): void {
    // Error frames carry the stable code; detailed reasons stay in server logs
    // in production and reach clients only in development.
    const devDetail = reason ? ` (${reason})` : '';
    const message = process.env.NODE_ENV === 'production' ? code : `${code}${devDetail}`;
    conn.send(
      JSON.stringify(signalingErrorFrame(replyTo ?? newRequestId(), code, message.slice(0, 64))),
    );
  }

  /** Decode + route one text frame. Returns whether to close the socket. */
  async handleFrame(conn: SignalingConnection, raw: string): Promise<InboundResult> {
    const parsed = decodeSignalingFrame(raw);
    if (!parsed.ok) {
      this.sendError(conn, parsed.error.code, parsed.error.message);
      return FATAL(WS_CLOSE_PROTOCOL_ERROR);
    }
    return this.dispatch(conn, parsed.value);
  }

  async dispatch(conn: SignalingConnection, frame: SignalingMessage): Promise<InboundResult> {
    const reg = this.deps.registry.get(conn.connId);
    if (!reg) return FATAL(WS_CLOSE_POLICY);

    if (frame.type === 'hello') return this.onHello(conn, frame);
    if (frame.type === 'auth.proof') return await this.onAuthProof(conn, frame);
    if (reg.role === null || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'hello required before other messages');
      return FATAL(WS_CLOSE_PROTOCOL_ERROR);
    }
    this.deps.registry.touch(conn.connId, this.deps.nowMs());

    switch (frame.type) {
      case 'pair.create':
        return this.onPairCreate(conn, frame);
      case 'pair.join':
        return this.onPairJoin(conn, frame);
      case 'pair.accept':
        return this.onPairAccept(conn, frame);
      case 'pair.reject':
        return this.onPairReject(conn, frame);
      case 'session.request':
        return this.onSessionRequest(conn, frame);
      case 'session.accepted':
        return this.onSessionAccepted(conn, frame);
      case 'session.rejected':
        return this.onSessionRejected(conn, frame);
      case 'session.close':
        return this.onSessionClose(conn, frame);
      case 'signal.offer':
        return this.relaySignal(conn, frame, 'desktop');
      case 'signal.answer':
        return this.relaySignal(conn, frame, 'phone');
      case 'signal.ice':
        return this.relaySignal(conn, frame, null);
      case 'presence.ping':
        conn.send(JSON.stringify(signalingFrame('presence.pong', { ts: frame.payload.ts })));
        return OK;
      default:
        // Client-to-server channels never send server-originated types.
        this.sendError(conn, 'MESSAGE_INVALID', 'unexpected message for this state');
        return FATAL(WS_CLOSE_PROTOCOL_ERROR);
    }
  }

  private onHello(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'hello' }>,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (!reg) return FATAL(WS_CLOSE_POLICY);
    if (reg.role !== null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'hello already sent');
      return FATAL(WS_CLOSE_PROTOCOL_ERROR);
    }
    const bound = this.deps.registry.bind(conn.connId, frame.payload.role, frame.payload.deviceId);
    if (!bound) {
      this.sendError(conn, 'SESSION_CONFLICT', 'device already connected elsewhere');
      return FATAL(WS_CLOSE_POLICY);
    }
    this.deps.log.info('hello', {
      connId: conn.connId,
      role: frame.payload.role,
      deviceId: frame.payload.deviceId,
    });
    conn.send(
      JSON.stringify(
        signalingFrame(
          'hello.ok',
          { heartbeatIntervalSec: 15, heartbeatTimeoutSec: 45 },
          { replyTo: frame.id },
        ),
      ),
    );
    // Device auth (#018): challenge the hello identity; the proof binds the
    // connection to the device key registered on success.
    this.pendingAuth.set(conn.connId, {
      nonce: bytesToBase64url(crypto.getRandomValues(new Uint8Array(16))),
      failures: 0,
    });
    conn.send(
      JSON.stringify(
        signalingFrame('auth.challenge', { nonce: this.pendingAuth.get(conn.connId)?.nonce ?? '' }),
      ),
    );
    return OK;
  }

  private async onAuthProof(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'auth.proof' }>,
  ): Promise<InboundResult> {
    const pending = this.pendingAuth.get(conn.connId);
    const reg = this.deps.registry.get(conn.connId);
    if (!pending || !reg?.deviceId) {
      this.sendError(conn, 'MESSAGE_INVALID', 'no pending auth challenge');
      return FATAL(WS_CLOSE_PROTOCOL_ERROR);
    }
    const deviceId = reg.deviceId;
    const proof = frame.payload;
    // The claimed fingerprint must match the presented key.
    const fp = await fingerprintFromSpkiB64(proof.publicKeySpki);
    if (fp !== proof.publicKeyFingerprint) {
      return this.authFailure(conn, deviceId, 'fingerprint mismatch');
    }
    if (this.deps.devices.isRevoked(deviceId)) {
      this.sendError(conn, 'DEVICE_REVOKED', undefined);
      return FATAL(WS_CLOSE_POLICY);
    }
    let ok = false;
    try {
      const pub = await importPublicKeySpki(base64urlToBytes(proof.publicKeySpki));
      const transcript = encodeTranscript([WS_AUTH_DOMAIN, '1', pending.nonce, deviceId]);
      ok = await crypto.subtle.verify(
        WS_SIGN_ALG,
        pub,
        base64urlToBytes(proof.signature),
        transcript,
      );
    } catch {
      ok = false;
    }
    if (!ok) {
      return this.authFailure(conn, deviceId, 'invalid signature');
    }
    // Identity continuity (#24/#25): a known deviceId must present exactly
    // its registered key; unknown devices enroll only in open mode.
    const known = this.deps.devices.get(deviceId);
    if (known) {
      if (
        known.publicKeySpki !== proof.publicKeySpki ||
        known.fingerprint !== proof.publicKeyFingerprint
      ) {
        this.deps.log.warn('device.key_conflict', { connId: conn.connId, deviceId });
        return this.authFailure(conn, deviceId, 'key does not match the registered identity');
      }
    } else if (this.deps.deviceAuthMode === 'required') {
      this.deps.log.warn('device.enrollment_closed', { connId: conn.connId, deviceId });
      return this.authFailure(conn, deviceId, 'device not registered');
    } else {
      this.deps.devices.enroll(
        deviceId,
        proof.publicKeySpki,
        proof.publicKeyFingerprint,
        proof.displayName,
      );
    }
    this.pendingAuth.delete(conn.connId);
    this.authenticated.add(conn.connId);
    this.deps.log.info('device.authenticated', {
      connId: conn.connId,
      deviceId,
      registered: known === undefined,
    });
    conn.send(
      JSON.stringify(
        signalingFrame('auth.ok', { registered: known === undefined }, { replyTo: frame.id }),
      ),
    );
    return OK;
  }

  private authFailure(conn: SignalingConnection, deviceId: string, reason: string): InboundResult {
    const pending = this.pendingAuth.get(conn.connId);
    const failures = (pending?.failures ?? 0) + 1;
    if (pending) pending.failures = failures;
    this.deps.log.warn('device.auth_failed', { connId: conn.connId, deviceId, failures, reason });
    if (this.deps.deviceAuthMode === 'required' || failures >= MAX_AUTH_FAILURES) {
      return FATAL(WS_CLOSE_POLICY);
    }
    // Open mode tolerates devices whose keys are not yet registered (first
    // pairing) while still closing the socket on repeated failures.
    return OK;
  }

  /** Pair/session flows demand an authenticated connection in required mode. */
  private requireAuthenticated(conn: SignalingConnection): boolean {
    return this.deps.deviceAuthMode === 'open' || this.authenticated.has(conn.connId);
  }

  private onPairCreate(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'pair.create' }>,
  ): InboundResult {
    if (!this.requireAuthenticated(conn)) {
      this.sendError(conn, 'MESSAGE_INVALID', 'device authentication required');
      return FATAL(WS_CLOSE_POLICY);
    }
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'desktop' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'pair.create requires desktop role');
      return FATAL(WS_CLOSE_POLICY);
    }
    const open = this.deps.pairings.findOpenByDesktopConn(conn.connId);
    if (open) {
      // Supersede: a desktop may only present one open pairing at a time.
      open.state = 'CANCELLED';
      this.deps.pairings.update(open);
    }
    const pairId = newPairId();
    const now = this.deps.nowMs();
    const expiresAtMs = now + frame.payload.ttlSeconds * 1000;
    this.deps.pairings.create({
      pairId,
      desktopConnId: conn.connId,
      desktopDeviceId: reg.deviceId,
      desktopDisplayName: frame.payload.displayName,
      desktopSpki: frame.payload.publicKeySpki,
      desktopFingerprint: frame.payload.publicKeyFingerprint,
      state: 'CREATED',
      createdAtMs: now,
      expiresAtMs,
    });
    this.deps.log.info('pair.create', { pairId, deviceId: reg.deviceId });
    conn.send(
      JSON.stringify(
        signalingFrame('pair.created', { pairId, expiresAtMs }, { replyTo: frame.id }),
      ),
    );
    return OK;
  }

  private onPairJoin(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'pair.join' }>,
  ): InboundResult {
    if (!this.requireAuthenticated(conn)) {
      this.sendError(conn, 'MESSAGE_INVALID', 'device authentication required');
      return FATAL(WS_CLOSE_POLICY);
    }
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'phone' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'pair.join requires phone role');
      return FATAL(WS_CLOSE_POLICY);
    }
    if (this.deps.devices.isRevoked(reg.deviceId)) {
      this.sendError(conn, 'DEVICE_REVOKED', undefined, frame.id);
      return OK;
    }
    const pairing = this.deps.pairings.get(frame.payload.pairId);
    if (!pairing || pairing.state === 'EXPIRED' || pairing.state === 'CANCELLED') {
      this.sendError(conn, 'PAIR_EXPIRED', undefined, frame.id);
      return OK;
    }
    if (pairing.state === 'CONSUMED') {
      this.sendError(conn, 'PAIR_ALREADY_USED', undefined, frame.id);
      return OK;
    }
    if (pairing.state === 'REJECTED') {
      this.sendError(conn, 'PAIR_INVALID_PROOF', undefined, frame.id);
      return OK;
    }
    if (this.deps.nowMs() >= pairing.expiresAtMs) {
      pairing.state = 'EXPIRED';
      this.deps.pairings.update(pairing);
      this.sendError(conn, 'PAIR_EXPIRED', undefined, frame.id);
      return OK;
    }
    pairing.state = 'JOINED';
    pairing.phoneConnId = conn.connId;
    pairing.phoneDeviceId = frame.payload.deviceId;
    pairing.phoneDisplayName = frame.payload.displayName;
    pairing.phoneSpki = frame.payload.publicKeySpki;
    pairing.phoneFingerprint = frame.payload.publicKeyFingerprint;
    this.deps.pairings.update(pairing);

    const desktop = pairing.desktopConnId;
    // The proof itself is verified by the desktop; the server cannot (it never
    // sees the secret) and therefore relays the join opaquely.
    this.send(desktop, frame);
    this.deps.log.info('pair.join', { pairId: pairing.pairId });
    return OK;
  }

  private decidePairing(
    conn: SignalingConnection,
    frame:
      | Extract<SignalingMessage, { type: 'pair.accept' }>
      | Extract<SignalingMessage, { type: 'pair.reject' }>,
    accept: boolean,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'desktop' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'pairing decisions require desktop role');
      return FATAL(WS_CLOSE_POLICY);
    }
    const pairing = this.deps.pairings.get(frame.payload.pairId);
    if (!pairing) {
      this.sendError(conn, 'SESSION_NOT_FOUND', undefined, frame.id);
      return OK;
    }
    if (pairing.desktopDeviceId !== reg.deviceId || pairing.desktopConnId !== conn.connId) {
      this.sendError(conn, 'MESSAGE_INVALID', 'only the pairing desktop decides');
      return FATAL(WS_CLOSE_POLICY);
    }
    if (pairing.state !== 'JOINED') {
      const code = pairing.state === 'CONSUMED' ? 'PAIR_ALREADY_USED' : 'PAIR_EXPIRED';
      this.sendError(conn, code, undefined, frame.id);
      return OK;
    }

    if (!accept) {
      pairing.state = 'REJECTED';
      this.deps.pairings.update(pairing);
      const rejected = signalingFrame(
        'pair.rejected',
        { pairId: pairing.pairId, code: 'PAIR_INVALID_PROOF' },
        {},
      );
      this.send(pairing.desktopConnId, { ...rejected, replyTo: frame.id } as SignalingMessage);
      if (pairing.phoneConnId) this.send(pairing.phoneConnId, rejected);
      this.deps.log.info('pair.rejected', { pairId: pairing.pairId });
      return OK;
    }

    pairing.state = 'CONSUMED';
    this.deps.pairings.update(pairing);
    if (
      !pairing.phoneConnId ||
      !pairing.phoneDeviceId ||
      !pairing.phoneSpki ||
      !pairing.phoneFingerprint
    ) {
      this.sendError(conn, 'PAIR_EXPIRED', 'no pending phone join', frame.id);
      return OK;
    }
    const acceptedPayload = {
      pairId: pairing.pairId,
      desktop: {
        deviceId: pairing.desktopDeviceId,
        displayName: pairing.desktopDisplayName,
        publicKeySpki: pairing.desktopSpki,
        publicKeyFingerprint: pairing.desktopFingerprint,
      },
      phone: {
        deviceId: pairing.phoneDeviceId,
        displayName: pairing.phoneDisplayName,
        publicKeySpki: pairing.phoneSpki,
        publicKeyFingerprint: pairing.phoneFingerprint,
      },
    };
    this.send(
      pairing.desktopConnId,
      signalingFrame('pair.accepted', acceptedPayload, { replyTo: frame.id }),
    );
    this.send(pairing.phoneConnId, signalingFrame('pair.accepted', acceptedPayload));
    this.deps.log.info('pair.accepted', { pairId: pairing.pairId });
    return OK;
  }

  private onPairAccept(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'pair.accept' }>,
  ): InboundResult {
    return this.decidePairing(conn, frame, true);
  }

  private onPairReject(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'pair.reject' }>,
  ): InboundResult {
    return this.decidePairing(conn, frame, false);
  }

  private sessionRequestKey(desktopDeviceId: string, phoneDeviceId: string): string {
    return `${desktopDeviceId}|${phoneDeviceId}`;
  }

  private onSessionRequest(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'session.request' }>,
  ): InboundResult {
    if (!this.requireAuthenticated(conn)) {
      this.sendError(conn, 'MESSAGE_INVALID', 'device authentication required');
      return FATAL(WS_CLOSE_POLICY);
    }
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'phone' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'session.request requires phone role');
      return FATAL(WS_CLOSE_POLICY);
    }
    if (this.deps.devices.isRevoked(reg.deviceId) || this.deps.devices.isRevoked(frame.payload.desktopDeviceId)) {
      this.sendError(conn, 'DEVICE_REVOKED', undefined, frame.id);
      return OK;
    }
    const desktopConnId = this.deps.registry.connIdForDevice(frame.payload.desktopDeviceId);
    if (!desktopConnId) {
      this.sendError(conn, 'SESSION_NOT_FOUND', 'desktop offline', frame.id);
      return OK;
    }
    this.sessionRequests.set(this.sessionRequestKey(frame.payload.desktopDeviceId, reg.deviceId), {
      phoneConnId: conn.connId,
      frame,
    });
    this.send(desktopConnId, frame);
    this.deps.log.info('session.request', {
      to: frame.payload.desktopDeviceId,
      from: reg.deviceId,
    });
    return OK;
  }

  private onSessionAccepted(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'session.accepted' }>,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'desktop' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'session.accepted requires desktop role');
      return FATAL(WS_CLOSE_POLICY);
    }
    const key = this.sessionRequestKey(reg.deviceId, frame.payload.phoneDeviceId);
    const request = this.sessionRequests.get(key);
    if (!request) {
      this.sendError(conn, 'SESSION_NOT_FOUND', 'no pending session request', frame.id);
      return OK;
    }
    this.sessionRequests.delete(key);
    if (frame.payload.desktopDeviceId !== reg.deviceId) {
      this.sendError(conn, 'MESSAGE_INVALID', 'session.accepted desktop mismatch');
      return FATAL(WS_CLOSE_POLICY);
    }
    for (const deviceId of [reg.deviceId, frame.payload.phoneDeviceId]) {
      if (this.deps.sessions.findOpenByDevice(deviceId)) {
        this.sendError(conn, 'SESSION_CONFLICT', 'a device already has an open session', frame.id);
        this.send(
          request.phoneConnId,
          signalingFrame('session.rejected', { code: 'SESSION_CONFLICT' }),
        );
        return OK;
      }
    }
    const session = {
      sessionId: frame.payload.sessionId,
      desktopDeviceId: frame.payload.desktopDeviceId,
      phoneDeviceId: frame.payload.phoneDeviceId,
      desktopConnId: conn.connId,
      phoneConnId: request.phoneConnId,
      state: 'SIGNALING' as const,
      createdAtMs: this.deps.nowMs(),
    };
    this.deps.sessions.create(session);
    this.send(request.phoneConnId, frame);
    this.deps.log.info('session.accepted', { sessionId: session.sessionId });
    return OK;
  }

  private onSessionRejected(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'session.rejected' }>,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.role !== 'desktop' || reg.deviceId === null) {
      this.sendError(conn, 'MESSAGE_INVALID', 'session.rejected requires desktop role');
      return FATAL(WS_CLOSE_POLICY);
    }
    // Best effort: forward rejection to every pending request for this desktop.
    for (const [key, request] of this.sessionRequests) {
      if (request.frame.payload.desktopDeviceId === reg.deviceId) {
        this.sessionRequests.delete(key);
        this.send(request.phoneConnId, frame);
      }
    }
    this.deps.log.info('session.rejected', {});
    return OK;
  }

  private onSessionClose(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'session.close' }>,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.deviceId === null || reg?.deviceId === undefined) return FATAL(WS_CLOSE_POLICY);
    const session = this.deps.sessions.get(frame.payload.sessionId);
    if (!session) {
      this.sendError(conn, 'SESSION_NOT_FOUND', undefined, frame.id);
      return OK;
    }
    if (session.desktopConnId !== conn.connId && session.phoneConnId !== conn.connId) {
      this.sendError(conn, 'MESSAGE_INVALID', 'not a session participant');
      return FATAL(WS_CLOSE_POLICY);
    }
    session.state = 'CLOSED';
    this.deps.sessions.update(session);
    const peerConnId =
      session.desktopConnId === conn.connId ? session.phoneConnId : session.desktopConnId;
    this.send(peerConnId, frame);
    this.deps.log.info('session.close', {
      sessionId: session.sessionId,
      reason: frame.payload.reason,
    });
    return OK;
  }

  private relaySignal(
    conn: SignalingConnection,
    frame: Extract<SignalingMessage, { type: 'signal.offer' | 'signal.answer' | 'signal.ice' }>,
    requireRole: 'desktop' | 'phone' | null,
  ): InboundResult {
    const reg = this.deps.registry.get(conn.connId);
    if (reg?.deviceId === null || reg?.deviceId === undefined) return FATAL(WS_CLOSE_POLICY);
    if (requireRole && reg.role !== requireRole) {
      this.sendError(conn, 'MESSAGE_INVALID', `${frame.type} requires ${requireRole} role`);
      return FATAL(WS_CLOSE_POLICY);
    }
    const session = this.deps.sessions.get(frame.payload.sessionId);
    if (!session || session.state === 'CLOSED') {
      this.sendError(conn, 'SESSION_NOT_FOUND', undefined);
      return OK;
    }
    if (session.desktopConnId !== conn.connId && session.phoneConnId !== conn.connId) {
      this.sendError(conn, 'MESSAGE_INVALID', 'not a session participant');
      return FATAL(WS_CLOSE_POLICY);
    }
    const peerConnId =
      session.desktopConnId === conn.connId ? session.phoneConnId : session.desktopConnId;
    this.send(peerConnId, frame);
    return OK;
  }

  /** Transport notifies the router when a socket dies: unwind dependent state. */
  handleConnClosed(connId: string): void {
    this.handles.delete(connId);
    this.authenticated.delete(connId);
    this.pendingAuth.delete(connId);
    const reg = this.deps.registry.unregister(connId);
    if (!reg) return;
    // Cancel open pairings presented or joined by this connection.
    for (const p of this.pairingsOf(connId)) {
      if (p.state === 'CREATED' || p.state === 'JOINED') {
        p.state = 'CANCELLED';
        this.deps.pairings.update(p);
        if (p.phoneConnId && p.phoneConnId !== connId) {
          this.send(
            p.phoneConnId,
            signalingFrame('pair.rejected', { pairId: p.pairId, code: 'PAIR_EXPIRED' }),
          );
        }
      }
    }
    // Close sessions involving this connection and notify the peer.
    for (const s of this.sessionsOf(connId)) {
      if (s.state === 'CLOSED') continue;
      s.state = 'CLOSED';
      this.deps.sessions.update(s);
      const peerConnId = s.desktopConnId === connId ? s.phoneConnId : s.desktopConnId;
      this.send(
        peerConnId,
        signalingFrame('session.close', { sessionId: s.sessionId, reason: 'peer-left' }),
      );
    }
    for (const [key, request] of this.sessionRequests) {
      if (request.phoneConnId === connId) this.sessionRequests.delete(key);
    }
    this.deps.log.info('conn.closed', { connId });
  }

  private pairingsOf(connId: string): NonNullable<ReturnType<PairingRepo['get']>>[] {
    return this.deps.pairings
      .listOpen()
      .filter((p) => p.desktopConnId === connId || p.phoneConnId === connId);
  }

  private sessionsOf(connId: string): NonNullable<ReturnType<SessionRepo['get']>>[] {
    return this.deps.sessions
      .listOpen()
      .filter((s) => s.desktopConnId === connId || s.phoneConnId === connId);
  }
}
