/**
 * Phone-side remote session: signaling (phone role) plus the receiving
 * RTCPeerHandle. Framework-agnostic so React only renders state snapshots.
 *
 * Phone flow: hello(phone) → session.request → accepted → offer/answer →
 * ICE → control opens → MUTUAL PEER PROOF (#014) → ACTIVE. Input stays
 * disabled until the laptop's signed proof verifies against the key stored
 * at pairing time.
 */

import type { HandshakeDeps } from '@remotetab/crypto';
import {
  base64urlToBytes,
  bytesToBase64url,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  PeerAuthHandshake,
} from '@remotetab/crypto';
import {
  ControlSender,
  decodeControlFrame,
  decodeSignalingFrame,
  newRequestId,
  presencePingSchema,
  type SignalingMessage,
  sessionRequestSchema,
  signalAnswerSchema,
  signalIceSchema,
  signalingFrame,
} from '@remotetab/protocol';
import { RTCPeerHandle } from '@remotetab/webrtc';
import { getPairedDesktop, loadPhoneKeys } from './pairing.ts';

export type RemotePhase =
  | 'idle'
  | 'connecting'
  | 'requesting'
  | 'signaling'
  | 'peer-connected'
  | 'authenticating'
  | 'active'
  | 'reconnecting'
  | 'ended';

export type RemoteStatus = {
  phase: RemotePhase;
  message: string | null;
  /** Set when the desktop revoked/ended with a definitive reason. */
  endedReason: 'user' | 'error' | 'revoked' | null;
};

export type ReceiverEvents = {
  status: RemoteStatus;
  track: MediaStreamTrack;
  controlOpen: boolean;
  /** Schema-validated laptop→phone control frames (viewport.sync etc.). */
  controlMessage: string;
  /** Target CSS viewport from viewport.sync frames. */
  viewport: { cssWidth: number; cssHeight: number; deviceScaleFactor: number };
};

export class ReceiverSession {
  private socket: WebSocket | null = null;
  private peer: RTCPeerHandle | null = null;
  private sessionIdValue: string | null = null;
  private phase: RemotePhase = 'idle';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners = new Set<(s: RemoteStatus) => void>();
  private trackListeners = new Set<(t: MediaStreamTrack) => void>();
  private controlListeners = new Set<(open: boolean) => void>();
  private controlMessageListeners = new Set<(raw: string) => void>();
  private viewportListeners = new Set<
    (v: { cssWidth: number; cssHeight: number; deviceScaleFactor: number }) => void
  >();
  private handshake: PeerAuthHandshake | null = null;
  private controlSender: ControlSender | null = null;
  private reconnectingSinceMs: number | null = null;
  /** Bounded reconnect window (RECONNECT_TTL_SECONDS, issue #016). */
  private readonly reconnectTtlMs: number;

  constructor(
    private readonly opts: {
      url: string;
      desktopDeviceId: string;
      identity: { deviceId: string; displayName: string };
      iceServers: { urls: string | string[] }[];
      reconnectTtlMs?: number;
      nowMs?: () => number;
    },
  ) {
    this.reconnectTtlMs = opts.reconnectTtlMs ?? 60_000;
  }

  on<K extends keyof ReceiverEvents>(
    event: K,
    handler: (payload: ReceiverEvents[K]) => void,
  ): () => void {
    const set =
      event === 'status'
        ? this.statusListeners
        : event === 'track'
          ? this.trackListeners
          : event === 'controlOpen'
            ? this.controlListeners
            : event === 'controlMessage'
              ? this.controlMessageListeners
              : this.viewportListeners;
    set.add(handler as (p: unknown) => void);
    return () => {
      set.delete(handler as (p: unknown) => void);
    };
  }

  private setStatus(
    phase: RemotePhase,
    message: string | null = null,
    endedReason: RemoteStatus['endedReason'] = null,
  ): void {
    this.phase = phase;
    const status: RemoteStatus = { phase, message, endedReason };
    for (const handler of this.statusListeners) handler(status);
  }

  get currentPhase(): RemotePhase {
    return this.phase;
  }

  /** The accepted session id, or null before acceptance. */
  get sessionId(): string | null {
    return this.sessionIdValue;
  }

  connect(): void {
    if (this.socket) return;
    this.setStatus('connecting');
    const socket = new WebSocket(this.opts.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify(
          signalingFrame(
            'hello',
            {
              role: 'phone',
              deviceId: this.opts.identity.deviceId,
              displayName: this.opts.identity.displayName,
            },
            { id: newRequestId() },
          ),
        ),
      );
    };
    socket.onmessage = (ev) => this.onFrame(String(ev.data));
    socket.onclose = () => {
      this.stopPings();
      if (this.phase !== 'ended' && this.phase !== 'idle') {
        this.reconnectingSinceMs ??= (this.opts.nowMs ?? Date.now)();
        if (
          isReconnectExpired(
            this.reconnectingSinceMs,
            (this.opts.nowMs ?? Date.now)(),
            this.reconnectTtlMs,
          )
        ) {
          this.setStatus(
            'ended',
            'Could not reconnect within the time window. Connect again.',
            'error',
          );
          this.cleanup();
          return;
        }
        this.setStatus('reconnecting', 'Reconnecting securely…');
      }
      // Fresh peer connection + fresh session on every reconnect (#016).
      this.closePeer();
      this.socket = null;
      if (this.phase !== 'ended' && this.phase !== 'idle') {
        setTimeout(() => {
          if (this.phase === 'reconnecting') this.connect();
        }, 1500);
      }
    };
    socket.onerror = () => {
      // onclose follows.
    };
  }

  private onFrame(raw: string): void {
    const frame = decodeSignalingFrame(raw);
    if (!frame.ok) {
      this.socket?.close(1002, 'protocol');
      return;
    }
    switch (frame.value.type) {
      case 'hello.ok': {
        this.setStatus('requesting');
        this.startPings();
        const req = sessionRequestSchema.parse({
          deviceId: this.opts.identity.deviceId,
          desktopDeviceId: this.opts.desktopDeviceId,
        });
        this.send(signalingFrame('session.request', req, { id: newRequestId() }));
        return;
      }
      case 'session.accepted': {
        // New epoch: fresh session id + sender sequence (#016).
        this.reconnectingSinceMs = null;
        this.sessionIdValue = frame.value.payload.sessionId;
        // One persistent phone→laptop sequence space per session (#014).
        this.controlSender = new ControlSender(this.sessionIdValue);
        this.setStatus('signaling');
        this.openPeer();
        return;
      }
      case 'session.rejected': {
        const code = frame.value.payload.code;
        const revoked = code === 'DEVICE_REVOKED';
        this.setStatus(
          'ended',
          revoked
            ? 'This computer revoked this device. Pair again from the laptop.'
            : `The laptop rejected the session (${code}).`,
          revoked ? 'revoked' : 'error',
        );
        this.cleanup();
        return;
      }
      case 'signal.offer': {
        if (frame.value.payload.sessionId !== this.sessionIdValue || !this.peer) return;
        void this.peer
          .acceptOffer({ type: 'offer', sdp: frame.value.payload.sdp })
          .then((answer) => {
            this.send(
              signalingFrame('signal.answer', {
                sessionId: this.sessionIdValue ?? '',
                sdp: answer.sdp ?? '',
              }),
            );
          })
          .catch(() => this.setStatus('reconnecting', 'Could not start the stream. Retrying…'));
        return;
      }
      case 'signal.ice': {
        const ice = signalIceSchema.parse(frame.value.payload);
        if (ice.sessionId !== this.sessionIdValue || !ice.candidate || !this.peer) return;
        void this.peer
          .addIceCandidate({
            candidate: ice.candidate,
            sdpMid: ice.sdpMid,
            sdpMLineIndex: ice.sdpMLineIndex,
            usernameFragment: ice.usernameFragment,
          })
          .catch(() => {
            // Unusable candidates are dropped by the transport.
          });
        return;
      }
      case 'session.close': {
        if (frame.value.payload.sessionId !== this.sessionIdValue) return;
        const reason = frame.value.payload.reason;
        this.setStatus(
          'ended',
          reason === 'revoked'
            ? 'This device was revoked by the laptop.'
            : 'Remote session ended on laptop.',
          reason === 'revoked' ? 'revoked' : 'user',
        );
        this.cleanup();
        return;
      }
      case 'error': {
        const code = frame.value.payload.code;
        if (code === 'CONNECTION_LOST' || code === 'SESSION_NOT_FOUND') {
          this.setStatus('reconnecting', 'Reconnecting securely…');
        }
        return;
      }
      default:
        return;
    }
  }

  private openPeer(): void {
    this.closePeer();
    const peer = new RTCPeerHandle('receiver', { iceServers: this.opts.iceServers });
    this.peer = peer;
    peer.on('track', (track) => {
      for (const handler of this.trackListeners) handler(track);
    });
    peer.on('connectionstate', (state) => {
      if (state === 'connected') {
        this.setStatus('peer-connected');
      } else if (state === 'failed') {
        this.setStatus('reconnecting', 'Stream failed. Retrying…');
      }
    });
    peer.on('control-open', () => {
      for (const handler of this.controlListeners) handler(true);
      // Mutual peer proof BEFORE any control is accepted (#014).
      void this.beginPeerAuth();
    });
    peer.on('control-close', () => {
      for (const handler of this.controlListeners) handler(false);
    });
    peer.on('control-message', (raw) => {
      this.onControlFrame(raw);
    });
    peer.on('icecandidate', (candidate) => {
      if (!candidate || !this.sessionIdValue) return;
      this.send(
        signalingFrame('signal.ice', {
          sessionId: this.sessionIdValue ?? '',
          candidate: candidate.candidate ?? '',
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          usernameFragment: candidate.usernameFragment ?? null,
        }),
      );
    });
  }

  private closePeer(): void {
    if (!this.peer) return;
    for (const handler of this.controlListeners) handler(false);
    this.peer.close();
    this.peer = null;
  }

  /** Relay one control frame; false when the channel is not usable. */
  sendControl(text: string): boolean {
    return this.peer?.sendControl(text) ?? false;
  }

  /**
   * Encode + send a phone→laptop control frame using the ONE persistent
   * per-session sequence space (multiple throwaway senders would reset the
   * seq counter and trip the laptop's replay guard).
   */
  sendControlFrame(build: (sender: ControlSender) => string): boolean {
    const sender = this.controlSender;
    if (sender === null || this.sessionIdValue === null) return false;
    return this.peer?.sendControl(build(sender)) ?? false;
  }

  /** Parse one laptop frame: peer-auth vs viewport sync. */
  private onControlFrame(raw: string): void {
    for (const handler of this.controlMessageListeners) handler(raw);
    const parsed = decodeControlFrame(raw);
    if (!parsed.ok) return;
    if (parsed.value.type === 'peer.challenge') {
      this.handshake?.onChallenge(parsed.value.payload.nonce);
      return;
    }
    if (parsed.value.type === 'peer.proof') {
      void this.handshake?.onProof(parsed.value.payload.signature).then((outcome) => {
        if (outcome === 'verified') {
          this.setStatus('active');
        } else if (outcome === 'failed') {
          this.setStatus('reconnecting', 'Peer verification failed.');
        }
      });
      return;
    }
    if (parsed.value.type === 'viewport.sync') {
      const v = parsed.value.payload;
      for (const handler of this.viewportListeners) handler(v);
    }
  }

  /**
   * Mutual peer proof (issue #014). The phone verifies the laptop against
   * the stored desktop key; the laptop independently verifies the phone.
   * Control stays disabled until BOTH sides have verified.
   */
  private async beginPeerAuth(): Promise<void> {
    const sessionId = this.sessionIdValue;
    if (sessionId === null) return;
    const desktop = await getPairedDesktop(this.opts.desktopDeviceId);
    if (!desktop) {
      this.setStatus(
        'ended',
        'This laptop is not paired with this phone. Pair again via QR.',
        'error',
      );
      this.cleanup();
      return;
    }
    const keys = await loadPhoneKeys();
    const priv = await importPrivateKeyPkcs8(base64urlToBytes(keys.privateKeyPkcs8));
    const pub = await importPublicKeySpki(base64urlToBytes(desktop.publicKeySpki));
    const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;
    const deps: HandshakeDeps = {
      role: 'phone',
      protocolVersion: '1',
      sessionId,
      myDeviceId: keys.deviceId,
      peerDeviceId: desktop.deviceId,
      myFingerprint: keys.fingerprint,
      peerFingerprint: desktop.fingerprint,
      sign: async (t) => bytesToBase64url(new Uint8Array(await crypto.subtle.sign(SIGN, priv, t))),
      verify: (t, sig) =>
        crypto.subtle.verify(SIGN, pub, base64urlToBytes(sig) as Uint8Array<ArrayBuffer>, t),
      sendChallenge: (nonce) => {
        this.sendControlFrame((s) => s.peerChallenge(nonce));
      },
      sendProof: (sig) => {
        this.sendControlFrame((s) =>
          s.peerProof({
            deviceId: keys.deviceId,
            publicKeyFingerprint: keys.fingerprint,
            signature: sig,
          }),
        );
      },
      timeoutMs: 10_000,
      onTimeout: () => {
        this.setStatus('reconnecting', 'Peer verification timed out. Retrying…');
      },
    };
    this.handshake = new PeerAuthHandshake(deps);
    this.setStatus('authenticating');
    this.handshake.start();
  }

  private send(frame: SignalingMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private startPings(): void {
    this.stopPings();
    this.pingTimer = setInterval(() => {
      this.send(signalingFrame('presence.ping', presencePingSchema.parse({ ts: Date.now() })));
    }, 15_000);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Stop everything (user-initiated or final). */
  disconnect(): void {
    this.setStatus('ended', 'Disconnected.', null);
    this.cleanup();
  }

  private cleanup(): void {
    this.stopPings();
    this.handshake = null;
    this.controlSender = null;
    this.reconnectingSinceMs = null;
    this.closePeer();
    this.sessionIdValue = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'client-stop');
      }
    }
  }
}

/** Reconnect must give up after the bounded TTL window. */
export function isReconnectExpired(
  reconnectingSinceMs: number,
  nowMs: number,
  ttlMs: number,
): boolean {
  return nowMs - reconnectingSinceMs > ttlMs;
}

export { signalAnswerSchema };
