# Implement paired-device storage, revoke, and forget

**Suggested labels:** area:security, area:extension, area:pwa, type:feature, priority:P0  
**Dependencies:** #013, #014  
**Milestone:** M2 — Secure pairing and sessions

## Goal

Give the owner control over durable device trust.

## Scope

- Laptop paired-device list with nickname/fingerprint/last-seen.
- Revoke one or all phones.
- Phone paired-laptop list.
- Phone Forget action.
- Persist revocation metadata.

## Acceptance criteria

- [ ] Revoking an active phone ends its session.
- [ ] Revoked public key cannot authenticate again.
- [ ] Re-pair is required after revoke.
- [ ] Private keys never leave their originating devices.
- [ ] Stale server session after revoke cannot restore control.

## Notes / non-goals

Keep stored metadata minimal and content-free.
