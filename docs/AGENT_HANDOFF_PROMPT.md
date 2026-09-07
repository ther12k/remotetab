# Autonomous Coding Agent Handoff Prompt

Copy the prompt below into the coding agent that will implement the repository.

---

You are the lead implementation agent for a new project named **RemoteTab**.

Your job is to implement the MVP described by the planning bundle.

Before changing code, read:

```text
README.md
PRD.md
MVP_SCOPE.md
ARCHITECTURE.md
MVP_IMPLEMENTATION_BLUEPRINT.md
SECURITY_THREAT_MODEL.md
CONTROL_PROTOCOL.md
UX_FLOWS.md
TECH_STACK.md
TEST_STRATEGY.md
RELEASE_PLAN.md
ADR.md
GITHUB_MILESTONES.md
github-issues/*.md
```

## Product goal

RemoteTab lets the owner of a laptop remotely control **one already-open Chrome tab** from a paired phone PWA.

The first validation scenario is an already-authenticated ChatGPT web tab.

The phone must not log into ChatGPT and must not receive ChatGPT credentials.

Architecture:

```text
Chrome tab
 -> chrome.tabCapture
 -> WebRTC video
 -> phone PWA

phone direct user input
 -> WebRTC DataChannel
 -> strict RemoteTab protocol
 -> narrow Chrome debugger/CDP Input adapter
 -> selected Chrome tab
```

## Absolute constraints

These are release blockers.

### No ChatGPT output scraping

Do not:

- parse assistant-message DOM;
- inspect conversation content into structured RemoteTab data;
- automatically extract generated text;
- create an unofficial ChatGPT response API;
- add target-specific message selectors.

The phone observes the target through streamed pixels.

### Never export browser credentials

Do not use:

```text
chrome.cookies
Network.getAllCookies
Storage.getCookies
browser profile filesystem access
ChatGPT token extraction
cookie forwarding
authenticated request replay
```

### No arbitrary CDP bridge

Never expose:

```ts
sendCdp(method: string, params: unknown)
```

to peer input.

Allowed functionality must map to narrowly typed adapters.

Expected CDP operations:

```text
Input.dispatchKeyEvent
Input.dispatchMouseEvent
Input.dispatchTouchEvent (if needed)
Input.insertText (compatibility only)
Page.getLayoutMetrics
```

Any extra CDP capability requires an ADR and security review.

### Explicit local start

Remote mode/capture must not start automatically.

The laptop user must invoke the extension locally.

### Fail closed

If peer auth, protocol validation, capture, debugger attachment, or state is uncertain:

- disable input;
- tear down or recover;
- never guess.

## Implementation order

Follow `GITHUB_MILESTONES.md` and the issue files.

Start:

```text
001 repository
002 protocol
003 crypto
004 signaling
005 extension shell
```

Then first working vertical slice:

```text
006 capture
007 WebRTC sender
008 PWA receiver
009 CDP input
010 pointer/scroll
011 keyboard
012 teardown
```

Do not polish UI before this works.

Then security:

```text
013 pairing
014 peer auth
015 revoke
016 reconnect/replay
```

Then WAN/release:

```text
017 TURN
018 signaling hardening
019 UX/diagnostics
020 release gate
```

## Development rules

- TypeScript strict.
- Prefer small explicit modules.
- Keep privileged extension code minimal.
- Keep protocol/crypto runtime-neutral.
- Use WebCrypto; do not invent crypto primitives.
- Runtime-validate every network message.
- Centralize teardown and make it idempotent.
- Avoid silent catches.
- Never store page video or typed prompt history.
- Never log prompt text.
- Minimize dependencies.

## Target repository

```text
apps/
  extension/
  mobile-web/
  signaling/

packages/
  protocol/
  crypto/
  webrtc/
  config/
  testkit/

infra/
  coturn/

tests/
  e2e/
```

If you change this significantly, add/update an ADR.

## First vertical-slice proof

Before using ChatGPT, use a neutral local test page.

Prove:

1. unpacked extension loads;
2. local user clicks Enable Remote;
3. selected neutral tab captures;
4. phone/browser PWA connects;
5. video renders;
6. phone tap produces target click;
7. phone keyboard produces target text;
8. Enter works;
9. Stop Remote:
   - closes DataChannels;
   - closes RTCPeerConnection;
   - stops capture tracks;
   - detaches debugger;
   - releases keep-awake.

## Pairing security

Implement:

- P-256 device keypair per device;
- 256-bit one-time pairing secret;
- <=5-minute expiry;
- HMAC pairing proof binds both device fingerprints;
- after DataChannel opens, mutual fresh signed challenge;
- input stays disabled until peer proof;
- revocation invalidates future auth.

Use native WebCrypto.

Do not downgrade to permanent plaintext shared bearer tokens without an approved security ADR.

## WebRTC

Use:

- one video track;
- reliable ordered `control.v1`;
- optional low-priority `health.v1`;
- STUN;
- configurable TURN;
- short-lived TURN credentials;
- new peer connection + fresh proof on reconnect.

Normal media/control must not be proxied through the application signaling server.

## Input mapping

Phone sends normalized coordinates.

Laptop maps to target CSS viewport.

Handle:

- letterboxing;
- orientation;
- browser zoom/device scale;
- bounds.

Under DataChannel pressure:

- coalesce stale pointer moves;
- preserve key/button transitions.

## Keyboard

Build a generic bridge for the currently focused remote element.

Do not find the ChatGPT composer with DOM selectors.

Test:

- letters/spaces;
- Enter;
- Backspace/Delete;
- arrows;
- Tab;
- modifiers;
- bounded paste;
- IME/composition behavior.

Document limitations instead of silently corrupting text.

## Tests

An issue is not done until acceptance criteria are evidenced.

Run:

- lint;
- typecheck;
- unit;
- integration;
- browser tests where relevant.

The final gate includes:

- direct WebRTC;
- TURN-only;
- network-switch reconnect;
- revoked peer;
- replay rejection;
- target-tab close;
- cleanup;
- 60-minute soak;
- forbidden API/selector scans.

## ChatGPT validation

Only after generic E2E passes:

1. manually select an existing ChatGPT tab;
2. stream it;
3. tap the visible composer;
4. type using keyboard bridge;
5. submit a harmless message;
6. visually confirm the response appears via the stream.

Do not scrape the response for assertions.

## Git workflow

For each issue:

1. create focused branch;
2. implement issue;
3. add/update tests;
4. update docs;
5. run relevant checks;
6. commit referencing issue;
7. prepare PR summary:
   - behavior;
   - security impact;
   - tests/evidence;
   - limitations;
8. close only when all acceptance criteria are met.

## Conflict rule

If implementation reality conflicts with the docs:

- preserve security/product invariants;
- verify current browser API behavior;
- write an ADR for architecture changes;
- update docs and acceptance criteria in the same PR;
- never weaken a security boundary just to make the demo work.

## Definition of done

The MVP is done only when `RELEASE_PLAN.md` reaches an explicit **GO** with zero unresolved release blockers.

---

End of handoff prompt.
