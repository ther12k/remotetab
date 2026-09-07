/**
 * Sender-side WebRTC session hosted in the offscreen document (issue #007).
 * Bridges the RTCPeerHandle (packages/webrtc) with the service worker over
 * runtime messaging. Every inbound control frame is schema-validated here
 * before it is relayed onward.
 */

import { decodeControlFrame } from '@remotetab/protocol';
import { RTCPeerHandle } from '@remotetab/webrtc';
import { browser } from 'wxt/browser';
import { isSenderRequest, type SenderRequest } from '@/messages.ts';

let session: {
  id: string;
  handle: RTCPeerHandle;
} | null = null;

// The capture adapter registers its stream here while a capture is active.
let activeStream: MediaStream | null = null;
export function setCaptureStream(stream: MediaStream | null): void {
  activeStream = stream;
}

function notify(event: Record<string, unknown>): void {
  void browser.runtime.sendMessage(event).catch(() => {
    // SW may be restarting; state reconciliation on wake covers this.
  });
}

function closeSession(): void {
  if (!session) return;
  session.handle.close();
  session = null;
}

export function handleSenderRequest(raw: unknown): boolean {
  if (!isSenderRequest(raw)) return false;
  const req: SenderRequest = raw;
  switch (req.type) {
    case 'sender:startSession':
      startSession(req.sessionId, req.iceServers);
      return true;
    case 'sender:applyAnswer':
      if (session && session.id === req.sessionId) {
        void session.handle
          .acceptAnswer({ type: req.answerType as RTCSdpType, sdp: req.sdp })
          .catch(() =>
            notify({ type: 'sender:peerState', sessionId: req.sessionId, state: 'answer-failed' }),
          );
      }
      return true;
    case 'sender:addIceCandidate':
      if (session && session.id === req.sessionId && req.candidate) {
        void session.handle.addIceCandidate(req.candidate).catch(() => {
          // Candidates can arrive before the remote description; the peer
          // rejects unusable ones and connection state drives recovery.
        });
      }
      return true;
    case 'sender:stopSession':
      if (!session || session.id === req.sessionId) closeSession();
      return true;
    case 'sender:sendControl':
      if (session && session.id === req.sessionId) {
        session.handle.sendControl(req.raw);
      }
      return true;
  }
  return false;
}

function startSession(sessionId: string, iceServers: { urls: string | string[] }[]): void {
  closeSession(); // one live session at a time
  const handle = new RTCPeerHandle('sender', { iceServers });

  handle.on('icecandidate', (candidate) => notify({ type: 'sender:ice', sessionId, candidate }));
  handle.on('connectionstate', (state) => notify({ type: 'sender:peerState', sessionId, state }));
  handle.on('control-open', () => notify({ type: 'sender:channelState', sessionId, open: true }));
  handle.on('control-close', () => notify({ type: 'sender:channelState', sessionId, open: false }));
  handle.on('control-message', (rawFrame) => {
    // Strict validation at the source; invalid frames never leave this doc.
    const parsed = decodeControlFrame(rawFrame);
    if (parsed.ok) notify({ type: 'sender:controlFrame', sessionId, raw: rawFrame });
    else notify({ type: 'sender:protocolViolation', sessionId, code: parsed.error.code });
  });

  const stream = activeStream;
  const [track] = stream?.getVideoTracks() ?? [];
  if (stream && track) {
    handle.addVideoTrack(track, stream);
  } else {
    notify({ type: 'sender:peerState', sessionId, state: 'no-track' });
  }

  session = { id: sessionId, handle };
  void handle
    .createOffer()
    .then((offer) => notify({ type: 'sender:offer', sessionId, sdp: offer.sdp ?? '' }))
    .catch((err: unknown) => {
      notify({
        type: 'sender:peerState',
        sessionId,
        state: 'offer-failed',
        detail: err instanceof Error ? err.name : 'unknown',
      });
    });
}
