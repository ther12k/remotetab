# Implement one-time QR pairing flow

**Suggested labels:** area:crypto, area:pwa, area:extension, area:signaling, type:security, priority:P0  
**Dependencies:** #003, #004, #005, #008  
**Milestone:** M2 — Secure pairing and sessions

## Goal

Pair phone and laptop without copying browser login state.

## Scope

- Generate >=256-bit one-time secret with <=5-minute expiry.
- Generate QR plus manual-code fallback.
- Phone creates device key.
- Pairing HMAC binds both public-key fingerprints.
- Laptop verifies and stores phone public key.
- Phone stores desktop public key.
- Consume/cancel pairing session.

## Acceptance criteria

- [ ] Expired pair fails.
- [ ] Reused secret fails.
- [ ] Wrong HMAC fails.
- [ ] Tampered identity/fingerprint fails.
- [ ] Secret is not placed in ordinary server access logs.
- [ ] Cancel invalidates pair.
- [ ] No ChatGPT credential participates.

## Notes / non-goals

Prefer URL fragment for secret-bearing browser payloads.
