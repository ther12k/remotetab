import { CONTROL_CHANNEL, HEALTH_CHANNEL } from '@remotetab/protocol';

/**
 * Typed wrapper around one RTCPeerConnection for RemoteTab sessions
 * (ADR-003): a single video track plus the reliable ordered `control.v1`
 * DataChannel, with an optional lossy `health.v1` channel. The protocol is
 * text-only; incoming binary data is ignored. The peer connection is
 * injected so unit tests can drive the handle with stubs.
 *
 * `close()` is idempotent and detaches every listener — reconnect churn must
 * never leak peer objects (issue #016).
 */

export type PeerRole = 'sender' | 'receiver';

export type PeerEvents = {
  icecandidate: RTCIceCandidateInit | null;
  connectionstate: RTCPeerConnectionState;
  'control-open': undefined;
  'control-close': undefined;
  'control-message': string;
  track: MediaStreamTrack;
};

type EventName = keyof PeerEvents;
type Handler<E extends EventName> = (payload: PeerEvents[E]) => void;
type VoidHandler = () => void;

export interface PeerDeps {
  createPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection;
}

/** Backpressure: refuse sends beyond this buffered amount (issue #010 tunes). */
export const MAX_CONTROL_BUFFERED = 1_000_000;

export class RTCPeerHandle {
  readonly pc: RTCPeerConnection;
  control: RTCDataChannel | null = null;
  health: RTCDataChannel | null = null;
  private readonly listeners = new Map<EventName, Set<Handler<EventName>>>();
  private closed = false;

  constructor(
    readonly role: PeerRole,
    options: { iceServers?: RTCIceServer[]; deps?: PeerDeps } = {},
  ) {
    const deps: PeerDeps = options.deps ?? {
      createPeerConnection: (iceServers) => new RTCPeerConnection({ iceServers }),
    };
    this.pc = deps.createPeerConnection(options.iceServers ?? []);

    this.pc.onicecandidate = (ev) =>
      this.emit('icecandidate', ev.candidate ? ev.candidate.toJSON() : null);
    this.pc.onconnectionstatechange = () => this.emit('connectionstate', this.pc.connectionState);
    this.pc.ontrack = (ev) => {
      const [track] = ev.track ? [ev.track] : [];
      if (track) this.emit('track', track);
    };

    if (role === 'sender') {
      // The sender owns channel creation; the receiver observes them.
      this.control = this.pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
      this.wireChannel(this.control, 'control-open', 'control-close', 'control-message');
      this.health = this.pc.createDataChannel(HEALTH_CHANNEL, {
        ordered: false,
        maxRetransmits: 0,
      });
      this.wireChannel(this.health, null, null, null);
    } else {
      this.pc.ondatachannel = (ev) => {
        const channel = ev.channel;
        if (channel.label === CONTROL_CHANNEL) {
          this.control = channel;
          this.wireChannel(channel, 'control-open', 'control-close', 'control-message');
        } else if (channel.label === HEALTH_CHANNEL) {
          this.health = channel;
          this.wireChannel(channel, null, null, null);
        }
        // Unknown channels are accepted by the transport but carry no
        // authority: only `control.v1` messages are ever validated/handled.
      };
    }
  }

  private wireChannel(
    channel: RTCDataChannel,
    openEvent: 'control-open' | null,
    closeEvent: 'control-close' | null,
    messageEvent: 'control-message' | null,
  ): void {
    if (openEvent) {
      channel.onopen = () => this.emit(openEvent, undefined);
    }
    if (closeEvent) {
      channel.onclose = () => this.emit(closeEvent, undefined);
    }
    if (messageEvent) {
      channel.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return; // protocol is text-only
        this.emit(messageEvent, ev.data);
      };
    }
  }

  private emit<E extends EventName>(event: E, payload: PeerEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) (handler as Handler<E>)(payload);
  }

  on<E extends EventName>(event: E, handler: Handler<E>): VoidHandler {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => {
      set.delete(handler as Handler<EventName>);
    };
  }

  addVideoTrack(track: MediaStreamTrack, stream: MediaStream): void {
    if (this.role !== 'sender') throw new Error('only the sender adds tracks');
    this.pc.addTrack(track, stream);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription?.toJSON() ?? offer;
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
  }

  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription?.toJSON() ?? answer;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate);
  }

  /** Reliable control send; false when closed or congested. */
  sendControl(text: string): boolean {
    const channel = this.control;
    if (channel === null || channel.readyState !== 'open') return false;
    if (channel.bufferedAmount > MAX_CONTROL_BUFFERED) return false;
    channel.send(text);
    return true;
  }

  /** Best-effort lossy health send. */
  sendHealth(text: string): boolean {
    const channel = this.health;
    if (channel === null || channel.readyState !== 'open') return false;
    channel.send(text);
    return true;
  }

  /** Idempotent close: detach listeners, close channels, close the peer. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.ondatachannel = null;
    for (const channel of [this.control, this.health]) {
      if (channel) {
        channel.onopen = null;
        channel.onclose = null;
        channel.onmessage = null;
        if (channel.readyState !== 'closed') channel.close();
      }
    }
    this.control = null;
    this.health = null;
    if (this.pc.connectionState !== 'closed') this.pc.close();
  }
}
