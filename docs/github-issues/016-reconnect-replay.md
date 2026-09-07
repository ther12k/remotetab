# Implement secure reconnect, sequence guard, and stale-session rejection

**Suggested labels:** area:protocol, area:webrtc, area:security, type:feature, priority:P0  
**Dependencies:** #014, #015  
**Milestone:** M2 — Secure pairing and sessions

## Goal

Survive normal phone network changes without weakening authorization.

## Scope

- Bounded reconnect window.
- New RTCPeerConnection.
- Fresh peer challenge.
- Fresh session id/epoch.
- Sequence guard bound to session.
- Clear reconnecting UI.

## Acceptance criteria

- [ ] Input is disabled while reconnecting.
- [ ] Reconnect performs fresh peer proof.
- [ ] Old session id is rejected.
- [ ] Duplicate/rollback sequence is rejected.
- [ ] Reconnect TTL expires cleanly.
- [ ] Wi-Fi/mobile switch test passes.
- [ ] Repeated reconnect does not leak peer objects/listeners.

## Notes / non-goals

Do not replay queued old user input after reconnection.
