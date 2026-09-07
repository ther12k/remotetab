# Harden signaling authentication, rate limits, and production logs

**Suggested labels:** area:signaling, area:security, type:security, priority:P0  
**Dependencies:** #004, #013, #014  
**Milestone:** M3 — WAN readiness and MVP gate

## Goal

Prepare the public signaling service for hostile traffic.

## Scope

- Authenticated device WebSocket connection.
- Pair/session routing authorization.
- Per-IP/device rate limits.
- Maximum frame/message sizes.
- Heartbeat eviction.
- Origin validation.
- Redacted logging.
- Durable metadata repository and readiness checks.

## Acceptance criteria

- [ ] Unauthorized device cannot signal another session.
- [ ] Pair brute-force attempts are throttled.
- [ ] Oversized payloads fail before expensive work.
- [ ] Secrets/prompt content are absent from logs.
- [ ] SDP/ICE logging policy is explicit and production-safe.
- [ ] Stale sockets are removed.
- [ ] Abuse integration tests pass.

## Notes / non-goals

The signaling service must never become a page-content store.
