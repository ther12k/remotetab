# Implement versioned signaling and control protocol schemas

**Suggested labels:** area:protocol, type:feature, priority:P0  
**Dependencies:** #001  
**Milestone:** M0 — Repository foundation

## Goal

Create the single source of truth for all RemoteTab wire messages.

## Scope

- Implement strict runtime schemas and TypeScript types for signaling, peer auth, pointer, wheel, keyboard, text insert, viewport sync, session stop, and errors.
- Implement Envelope validation for version, session id, sequence number, timestamp, type and bounded payload size.
- Provide message constructors and typed domain errors.

## Acceptance criteria

- [ ] Unknown protocol versions are rejected.
- [ ] Unknown message types are rejected.
- [ ] Malformed coordinates including NaN/Infinity are rejected.
- [ ] Text length is bounded.
- [ ] Duplicate/rollback sequences can be detected.
- [ ] Package has no browser/runtime-specific dependency.
- [ ] Unit tests cover malformed envelopes.

## Notes / non-goals

There must be no generic `cdp.command` protocol type.
