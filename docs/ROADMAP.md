# RemoteTab Roadmap — 0.1.0-alpha era

**Mindset for this phase: a working MVP that proves the core experience, not a
production-secure remote access product.**

Policy for this phase:

- Do NOT roll back completed security fixes (#21–#31). They are paid for,
  tested, and removing them adds regression risk without meaningfully
  accelerating the MVP.
- STOP adding hardening. Do not weaken current code either — just stop
  expanding it.
- Actively reject new security features unless they fix a demonstrated
  exploit or block the real remote-control flow. The project has enough
  architecture; it needs users tapping a screen and surfacing the real-world
  bugs unit tests will never reveal.

## Non-negotiables (front-door locks — already implemented, keep them)

- No zero-auth remote control: pairing + mutual peer proof stay.
- Signaling/control are never exposed to unauthenticated parties.
- No arbitrary CDP forwarding — narrow typed Input adapter only.
- No Chrome cookie/credential export — ever.
- No silent/background remote activation — explicit local click only.

## Priorities

### P0 — Make the damn thing work

1. Chrome extension loads
2. Click Enable Remote
3. Phone connects
4. Phone sees the tab
5. Tap works
6. Scroll works
7. Keyboard works
8. Enter works
9. ChatGPT response visible (pixels only)
10. Disconnect works

If any one fails → fix it. This is the only blocker for `0.1.0-alpha.1`,
formalized as the MVP gate in RELEASE.md.

### P1 — Make it usable

reconnect · rotation · keyboard UX · latency · viewer scaling · scroll feel ·
connection indicator · basic TURN

### P2 — Make it robust

revocation edge cases · soak · network matrix · advanced rate limits ·
device enrollment · multi-platform testing

### P3 — Production/security hardened

external audit · full TURN abuse protection · device attestation ·
origin restrictions · security monitoring · advanced identity management ·
long-lived device management

## Do NOT build (yet)

device management dashboard · analytics · connection-history page ·
security configuration page · advanced pairing management

The UI stays deliberately minimal: popup = tab name + connection dot +
Enable/Stop; phone = video + Pointer/Scroll/Keyboard.

## Release train

```
CURRENT MAIN
   │
   ▼
Real laptop + real phone ── video / tap / scroll / keyboard
   │
   ▼
Fix UX/integration bugs
   │
   ▼
ChatGPT real-tab validation
   │
   ▼
0.1.0-alpha.1  ──►  give to 2–5 people  ──►  observe failures
   │
   ▼
TURN + reconnect polish
   │
   ▼
0.1.0-alpha.2
   │
   ▼
only then security/production hardening (beta)
```

TURN is staged, not all-at-once:

| Stage | Scope |
|---|---|
| alpha.1 | same Wi-Fi / easy WAN path (STUN + direct) |
| alpha.2 | TURN works (signed issuance already merged) |
| beta | TURN abuse/operational hardening |

## Status vocabulary

Never say "NO-GO" for development MVP — it reads like the product failed.
Use:

```
Development status: IMPLEMENTATION READY
MVP status:         E2E VALIDATION REQUIRED
Public production:  NOT READY
```

Current artifact: **0.1.0-alpha.1 candidate**.
