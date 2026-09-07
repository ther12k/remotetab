# Build end-to-end, network, soak, and security MVP release gate

**Suggested labels:** area:test, area:security, type:test, priority:P0, needs-manual-evidence  
**Dependencies:** #012, #015, #016, #017, #018, #019  
**Milestone:** M3 — WAN readiness and MVP gate

## Goal

Turn the PRD into an evidence-backed GO/NO-GO release decision.

## Scope

- Neutral test-page extension E2E.
- Pairing/peer-auth negative tests.
- Replay tests.
- Direct WebRTC and TURN-only tests.
- Network-switch reconnect.
- 60-minute soak.
- Lifecycle cleanup checks.
- Forbidden API/selector scans.
- Manual real ChatGPT visual test.

## Acceptance criteria

- [ ] Every MVP checkbox in RELEASE_PLAN.md has evidence.
- [ ] Zero unresolved P0/release blockers.
- [ ] Credential-leak checks are clean.
- [ ] Arbitrary CDP path is absent.
- [ ] No ChatGPT DOM/output scraping exists.
- [ ] Permission manifest is reviewed.
- [ ] Support matrix and known limitations are published.
- [ ] Final decision explicitly states GO or NO-GO.

## Notes / non-goals

ChatGPT assertions are visual remote-render checks only; do not scrape assistant text.
