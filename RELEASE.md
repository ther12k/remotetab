# Release Gate (issue #020) — GO / NO-GO decision record

Decision: **NO-GO — alpha integration candidate.** The post-implementation
static audit (2026-09-08) found integration and identity-binding defects that
made the earlier "implementation-complete" claim unsafe. All audit issues
(#21–#30) are now fixed and merged; the decision stays NO-GO until the real
device evidence below is executed and recorded. Do not restore a conditional
GO until then.

This file is the evidence-backed decision record required by issue #020 and
docs/RELEASE_PLAN.md. Automated gates run in CI (`.github/workflows/ci.yml`)
and locally via `bun run gate`.

## Why NO-GO (audit findings, all fixed under #21–#30)

- #21 Popup validator rejected its own pairing/list messages (P0).
- #22 Phone bridges reset the sequence space per frame — the first real
  touch/keyboard input would trip the laptop replay guard (P0).
- #23 Pairing stored SPKI/fingerprint pairs without binding them
  cryptographically — a hostile signaling relay could substitute keys (P0).
- #24/#25 The device registry upserted identities, breaking key continuity;
  `DEVICE_AUTH=required` had no controlled enrollment path (P0/P1).
- #26/#27 Signaling heartbeat fired once and `close()` leaked the socket;
  WebRTC peer failure never triggered a fresh session (P1).
- #28/#29 The root gate skipped mobile-web typecheck; TURN credential
  issuance was unauthenticated and unthrottled (P1).
- #30 The phone signing key persisted exportable in localStorage (P2).

These are fixed in code with tests, but they were exactly the class of
cross-layer defect that unit tests alone missed — real-device evidence is
the only remaining proof of correctness.

## Automated gates (all green at the audit-fix merge)

| Gate | Evidence |
|---|---|
| Lint (Biome) | `bun run lint` — clean |
| Typecheck (strict, all workspaces incl. mobile-web) | `bun run typecheck` — clean |
| Unit/integration (Vitest) | 182 tests passing (protocol, crypto incl. SPKI fingerprint binding, webrtc signed TURN, session state, input gating, letterbox math, gesture/sender, paired-device store, popup contract, pairing identity binding, sequence continuity, peer-failure recovery, signaling client lifecycle) |
| Signaling integration (Bun test) | 44 tests passing (protocol enforcement, pair/session routing, WS device auth incl. key continuity + required-mode enrollment, authenticated TURN issuance incl. rate limiting, RFC 2202/4231 vectors) |
| Forbidden API/selector scan | `bun run test:security-scan` — clean (chrome.cookies, CDP cookie APIs, ChatGPT selectors, generic CDP bridge, forbidden manifest permissions) |
| Builds | extension (WXT → chrome-mv3), PWA (Vite + service worker), all packages |

## Release-blocker invariants (enforced by code + negative tests)

- [x] No ChatGPT DOM/output scraping — the wire protocol has no target-specific
      message types; a negative test proves `cdp.command` / `cdp` cannot parse.
- [x] No credential export — `chrome.cookies` / `Network.getAllCookies` /
      `Storage.getCookies` never appear in source; guardrail scan fails the
      build if introduced.
- [x] No generic CDP bridge — the adapter's `send()` is private with exactly
      four literal methods; a test asserts the adapter surface exposes no
      `sendCommand`.
- [x] No auto-start — capture requires the popup click (streamId is requested
      inside the click handler; ADR-013).
- [x] Fail closed — unknown versions/types/keys rejected; replay →
      REPLAY_REJECTED tears the session; peer auth gates input; debugger
      detach disarms; SW restart reconciles to idle; keep-awake released on
      every stop path.
- [x] Pairing security — 256-bit one-time secret, ≤5 min TTL, HMAC proof
      binding both fingerprints, consumed on use, revocation persisted.
- [x] Identity binding — received SPKI must hash to the claimed fingerprint
      on both pairing sides; the QR is the phone's source of truth (#23).
- [x] Key continuity — signaling never replaces a registered identity;
      required-mode enrollment only via the admin endpoint (#24/#25).
- [x] Signed TURN — credentials mint only for registered, matching,
      unrevoked devices; rate limited (#29).
- [x] One sequence owner — the phone emits strictly monotonic control
      frames from a single per-session sender (#22).

## Manual evidence required before ANY GO (restore Conditional GO only after 1–4; wider GO after 1–7)

Run and record in `docs/MANUAL_EVIDENCE.md`:

1. **Neutral-page E2E** (E2E-01…E2E-04): pair a real phone, stream the test
   page, verify grid clicks land exactly, text enters verbatim, Enter works,
   scroll moves the region without clicks. (Directly exercises the #22
   sequence fix — a first tap must NOT tear down the session.)
2. **Reconnect** (E2E-05): drop the phone network 5–15 s; input pauses, fresh
   peer proof, control resumes; also force a WebRTC-only failure and verify
   the session recycles (#27).
3. **Revoke** (E2E-06): revoke the active phone — session ends, reconnect
   fails with the revoked-device copy.
4. **TURN-only** (E2E-09): deploy `infra/coturn`, force relay, verify a full
   turn against the signed credential endpoint (#29); diagnostics show
   `transport: relay`.
5. **60-minute soak** (E2E-10): periodic interactions; assert no reconnect
   loop, no unbounded memory — and the laptop stays connected past 45 s of
   idle (heartbeat repeat, #26).
6. **Real ChatGPT visual test**: laptop logged in, phone NOT logged in; tap
   composer, type a harmless message via the keyboard bridge, submit, observe
   the response as pixels only; inspect RemoteTab logs/traffic for the absence
   of credentials or scraped output.
7. **Cleanup checks** (E2E-07/08): Stop releases debugger + keep-awake + tracks;
   target-tab close tears down.

## Known limitations (published)

- Manual code / QR pairing; no camera-app deep links.
- No audio (ADR-010), no file transfer, no multi-phone (ADR-009).
- IME: final committed text is mirrored; live composition is not.
- Pairings/sessions metadata are in-memory single-instance on the signaling
  service; device registry is durable only with DATABASE_URL.
- Per-connection (not per-IP) signaling throttling; TURN issuance is rate
  limited per registered device.
- Non-IndexedDB browsers fall back to a session-scoped (non-persistent)
  phone identity (#30).

## Decision rule

- **Alpha integration candidate (current):** automated gates green; NO
  release use.
- **Conditional GO:** items 1–4 recorded with dates/versions and zero open
  release blockers from docs/SECURITY_THREAT_MODEL.md §9.
- **Wider GO:** items 1–7 recorded AND zero open release blockers AND every
  automated gate green on the release commit.
