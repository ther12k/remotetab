# Implement extension WebRTC sender and control DataChannel

**Suggested labels:** area:extension, area:webrtc, type:feature, priority:P0  
**Dependencies:** #002, #006  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Send captured video to a peer and create the RemoteTab control channel.

## Scope

- RTCPeerConnection lifecycle.
- Inject ICE configuration.
- Add captured video track.
- Create reliable ordered `control.v1` DataChannel.
- Support offer/answer and trickle ICE.
- Expose connection state/stats.
- Cleanly close peer and timers.

## Acceptance criteria

- [ ] Offer can be generated and answer applied.
- [ ] Video track is negotiated.
- [ ] DataChannel opens.
- [ ] Every DataChannel message is schema validated before handling.
- [ ] Peer close removes timers/listeners.
- [ ] Unit/integration tests use a synthetic track where possible.

## Notes / non-goals

Do not add application-server media proxying.
