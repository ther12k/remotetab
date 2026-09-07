/**
 * Phone-side remote session: signaling (phone role) plus the receiving
 * RTCPeerHandle. Framework-agnostic so React only renders state snapshots.
 *
 * Phone flow: hello(phone) → hello.ok → session.request → session.accepted →
 * receive signal.offer → answer → ICE → control channel opens → ACTIVE.
 */

import {
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

export type RemotePhase =
  | 'idle'
  | 'connecting'
  | 'requesting'
  | 'signaling'
  | 'peer-connected'
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
};

export class ReceiverSession {
  private socket: WebSocket | null = null;
  private peer: RTCPeerHandle | null = null;
  private sessionId: string | null = null;
  private phase: RemotePhase = 'idle';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners = new Set<(s: RemoteStatus) => void>();
  private trackListeners = new Set<(t: MediaStreamTrack) => void>();
  private controlListeners = new Set<(open: boolean) => void>();

  constructor(
    private readonly opts: {
      url: string;
      desktopDeviceId: string;
      identity: { deviceId: string; displayName: string };
      iceServers: { urls: string | string[] }[];
    },
  ) {}

  on<K extends keyof ReceiverEvents>(
    event: K,
    handler: (payload: ReceiverEvents[K]) => void,
  ): () => void {
    const set =
      event === 'status'
        ? this.statusListeners
        : event === 'track'
          ? this.trackListeners
          : this.controlListeners;
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
        this.setStatus('reconnecting', 'Connection lost. Retrying…');
      }
      // Fresh peer connection on any reconnect (#016 finalizes the policy).
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
        this.sessionId = frame.value.payload.sessionId;
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
        if (frame.value.payload.sessionId !== this.sessionId || !this.peer) return;
        void this.peer
          .acceptOffer({ type: 'offer', sdp: frame.value.payload.sdp })
          .then((answer) => {
            this.send(
              signalingFrame('signal.answer', {
                sessionId: this.sessionId ?? '',
                sdp: answer.sdp ?? '',
              }),
            );
          })
          .catch(() => this.setStatus('reconnecting', 'Could not start the stream. Retrying…'));
        return;
      }
      case 'signal.ice': {
        const ice = signalIceSchema.parse(frame.value.payload);
        if (ice.sessionId !== this.sessionId || !ice.candidate || !this.peer) return;
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
        if (frame.value.payload.sessionId !== this.sessionId) return;
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
    });
    peer.on('control-close', () => {
      for (const handler of this.controlListeners) handler(false);
    });
    peer.on('icecandidate', (candidate) => {
      if (!candidate || !this.sessionId) return;
      this.send(
        signalingFrame('signal.ice', {
          sessionId: this.sessionId,
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
    this.closePeer();
    this.sessionId = null;
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

export { signalAnswerSchema };
