# Release Gate (issue #020) — GO / NO-GO decision record

Decision: **CONDITIONAL GO for local/MVP validation — remote-control MVP is
implementation-complete; a GO for wider release requires the manual evidence
below to be executed and recorded.**

This file is the evidence-backed decision record required by issue #020 and
docs/RELEASE_PLAN.md. Automated gates run in CI (`.github/workflows/ci.yml`)
and locally via `bun run gate`.

## Automated gates (all green at merge)

| Gate | Evidence |
|---|---|
| Lint (Biome) | `bun run lint` — clean |
| Typecheck (strict, all workspaces) | `bun run typecheck` — clean |
| Unit/integration (Vitest) | 151 tests passing (protocol, crypto, webrtc, session state, input gating, letterbox math, gesture/sender, paired-device store) |
| Signaling integration (Bun test) | 23 tests passing (protocol enforcement, replayed hello, duplicate device, pair/session routing, role enforcement, non-participant rejection, session conflict, WS device auth, TURN credentials incl. RFC 2202 vector) |
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

## Manual evidence required before a wider GO

Run and record in `docs/MANUAL_EVIDENCE.md`:

1. **Neutral-page E2E** (E2E-01…E2E-04): pair a real phone, stream the test
   page, verify grid clicks land exactly, text enters verbatim, Enter works,
   scroll moves the region without clicks.
2. **Reconnect** (E2E-05): drop the phone network 5–15 s; input pauses, fresh
   peer proof, control resumes; old-session frames rejected.
3. **Revoke** (E2E-06): revoke the active phone — session ends, reconnect
   fails with the revoked-device copy.
4. **TURN-only** (E2E-09): deploy `infra/coturn`, force relay, verify a full
   turn; diagnostics show `transport: relay`.
5. **60-minute soak** (E2E-10): periodic interactions; assert no reconnect
   loop, no unbounded memory (task manager + diagnostics).
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
- Per-connection (not per-IP) signaling throttling.

## Decision rule

Wider GO requires: every automated gate green on the release commit AND items
1–7 above recorded with dates/versions AND zero open release blockers from
docs/SECURITY_THREAT_MODEL.md §9.
