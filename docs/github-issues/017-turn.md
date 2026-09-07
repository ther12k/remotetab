# Add STUN/TURN configuration and short-lived TURN credentials

**Suggested labels:** area:infra, area:webrtc, area:signaling, type:feature, priority:P1  
**Dependencies:** #004, #016  
**Milestone:** M3 — WAN readiness and MVP gate

## Goal

Make WAN/mobile connectivity reliable across restrictive NAT/firewalls.

## Scope

- Configurable ICE server list.
- coturn reference deployment.
- Short-lived TURN credential endpoint/mechanism.
- TURN-only integration test.
- Direct-vs-relay diagnostics.

## Acceptance criteria

- [ ] No static TURN shared secret exists in clients.
- [ ] TURN credentials expire.
- [ ] Forced TURN-only session succeeds.
- [ ] Direct path is still preferred where possible.
- [ ] PWA can report relay/direct in diagnostics.
- [ ] Required deployment ports are documented.

## Notes / non-goals

Add quotas/abuse considerations for hosted TURN.
