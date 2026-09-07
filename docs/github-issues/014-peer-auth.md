# Authenticate paired peers over WebRTC before enabling control

**Suggested labels:** area:crypto, area:webrtc, area:security, type:security, priority:P0  
**Dependencies:** #003, #007, #008, #013  
**Milestone:** M2 — Secure pairing and sessions

## Goal

Make signaling-server identity alone insufficient to activate remote control.

## Scope

- Exchange fresh peer challenge after DataChannel opens.
- Sign canonical transcript with each device key.
- Verify stored peer public key.
- Bind protocol version, session id, both identities, roles and nonce.
- Enable input only after mutual verification.

## Acceptance criteria

- [ ] Control before peer auth is rejected.
- [ ] Wrong phone key fails.
- [ ] Wrong desktop key fails.
- [ ] Prior-session signature replay fails.
- [ ] Role-reflection attempt fails.
- [ ] Auth timeout closes session.
- [ ] Successful mutual proof transitions to ACTIVE.

## Notes / non-goals

Peer authentication is mandatory even if WSS signaling already authenticated the device.
