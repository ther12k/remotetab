# Build Hono/Bun WSS signaling service skeleton

**Suggested labels:** area:signaling, type:feature, priority:P0  
**Dependencies:** #001, #002  
**Milestone:** M0 — Repository foundation

## Goal

Create the internet-facing signaling service foundation without final pairing security yet.

## Scope

- Hono/Bun app with /health/live and /health/ready.
- WSS endpoint and connection registry abstraction.
- Strict protocol decoding.
- Heartbeat/stale-socket handling.
- Session routing abstraction.
- Structured redacted logger.
- In-memory repository for tests.

## Acceptance criteria

- [ ] Invalid JSON and oversized messages are rejected.
- [ ] Unknown protocol versions are rejected.
- [ ] Heartbeat removes stale sockets.
- [ ] Message text/payload content is not logged by default.
- [ ] Routing integration tests pass.
- [ ] Server shuts down cleanly.
- [ ] Deployment configuration is documented.

## Notes / non-goals

TURN credentials and durable production database can come later.
