# Release Gate — status record

```
Development status: IMPLEMENTATION READY
MVP status:         E2E VALIDATION REQUIRED
Public production:  NOT READY
```

Current artifact: **0.1.0-alpha.1 candidate** (docs/ROADMAP.md describes the
release train and phase policy).

## The MVP gate (only blocker for 0.1.0-alpha.1)

Prove this flow on a real laptop + real phone:

```
Open Chrome + ChatGPT → Enable Remote → phone connects → video appears
→ tap / scroll / type → send prompt → see ChatGPT response → disconnect
```

Concretely, all seven must pass:

1. [ ] Extension captures a real tab.
2. [ ] Phone receives the stream.
3. [ ] Tap / scroll / keyboard actually work on the target page.
4. [ ] One phone→laptop sequence space runs the whole session with zero
       REPLAY_REJECTED (peer auth + input from a single sender — the #23 fix).
5. [ ] Simple reconnect works (network drop → fresh session → control resumes).
6. [ ] Stop Remote really detaches the debugger, stops capture, releases
       keep-awake.
7. [ ] ChatGPT login/cookies stay on the laptop only — the phone observes
       pixels; logs/traffic contain no credentials and no scraped output.

If any single one fails → fix it, then re-run. That is the whole gate.

## Phase policy (docs/ROADMAP.md)

Completed security fixes (#21–#31) are locked in — never rolled back. No NEW
hardening in this phase: security features are rejected unless they fix a
demonstrated exploit or block the real remote-control flow.

Deferred to beta / hardening: 60-minute soak · multi-OS evidence · full iOS
compatibility · TURN abuse hardening · enterprise DEVICE_AUTH=required UX ·
admin enrollment polish · advanced rate limiting · device-management polish ·
advanced diagnostics · full network matrix · formal security audit ·
multi-device · biometric re-auth · encrypted signaling payloads · origin
allowlists.

TURN is staged: alpha.1 = same Wi-Fi / easy WAN (STUN + direct);
alpha.2 = TURN works (signed issuance is already merged, #30 — the
infrastructure did not get rolled back); beta = TURN abuse/ops hardening.

## Automated gates (all green)

| Gate | Evidence |
|---|---|
| Lint (Biome) | `bun run lint` — clean |
| Typecheck (strict, all workspaces incl. mobile-web) | `bun run typecheck` — clean |
| Unit/integration (Vitest) | 182 tests passing |
| Signaling integration (Bun test) | 44 tests passing |
| Forbidden API/selector scan | `bun run test:security-scan` — clean |
| Builds | extension (chrome-mv3), PWA (service worker), all packages |

## Release-blocker invariants (locked, enforced by code + negative tests)

These stay exactly as built; this phase adds nothing to them:

- No ChatGPT DOM/output scraping (`cdp.command` cannot parse — negative test).
- No credential export (`chrome.cookies` / CDP cookie APIs never appear;
  guardrail scan fails the build if introduced).
- No generic CDP bridge (adapter `send()` is private with four literal
  methods; surface test asserts it).
- No auto-start (capture streamId requested inside the popup click; ADR-013).
- Fail closed (replay → teardown, peer-auth gate, debugger-detach disarm,
  SW-restart reconcile, keep-awake released on every stop path).
- Pairing security (256-bit one-time secret, ≤5 min TTL, HMAC proof,
  consumed on use, revocation persisted).
- Identity binding (received SPKI must hash to the claimed fingerprint on
  both pairing sides; QR is the phone's source of truth — #24).
- Key continuity (signaling never replaces a registered identity; required
  mode enrolls only via the admin endpoint — #25/#26).
- Signed TURN (registered, matching, unrevoked devices only; rate limited —
  #30).
- One sequence owner (strictly monotonic phone frames from a single
  per-session sender — #23).

## How the gate moves

- **0.1.0-alpha.1**: MVP gate passes on real hardware → ship to 2–5 people.
- **0.1.0-alpha.2**: TURN + reconnect polish from observed failures.
- **beta**: begin the deferred hardening list above.

The old per-issue manual evidence checklists in docs/MANUAL_EVIDENCE.md are
NOT deleted — they are reclassified as beta evidence, recorded as the team
works through P2.
