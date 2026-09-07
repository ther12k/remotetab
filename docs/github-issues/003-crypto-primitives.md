# Implement WebCrypto device identity and pairing primitives

**Suggested labels:** area:crypto, area:security, type:security, priority:P0  
**Dependencies:** #001  
**Milestone:** M0 — Repository foundation

## Goal

Provide small reviewed wrappers for device identity, pairing proof and peer challenge verification.

## Scope

- P-256 ECDSA key generation.
- Public-key export/import and SHA-256 fingerprint.
- 256-bit random pairing secret.
- HMAC-SHA-256 pairing proof.
- Challenge signing/verification.
- Base64url codec and canonical transcript builder.

## Acceptance criteria

- [ ] No custom cryptographic primitive is implemented.
- [ ] Transcript contains an explicit version/domain separator.
- [ ] Wrong secret, wrong key and modified transcript fail.
- [ ] Serialization has stability test vectors.
- [ ] Private keys/secrets are never logged.
- [ ] Package works in extension and normal browser contexts.

## Notes / non-goals

Use WebCrypto only; do not substitute home-grown crypto.
