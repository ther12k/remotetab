# Architecture Decision Records

## ADR-001 — Remote rendering, not DOM extraction

**Status:** Accepted.

Phone receives a live video representation of the selected tab. RemoteTab does not parse ChatGPT output or expose a structured response API.

Reasons:

- preserves exact web behavior;
- avoids target DOM coupling;
- reduces fragility;
- fits remote-control semantics;
- avoids intentionally implementing automatic output extraction.

## ADR-002 — Chrome Manifest V3 extension

**Status:** Accepted.

Use an extension rather than a native desktop daemon because tab capture/debugger/power APIs align with the product.

## ADR-003 — WebRTC for media and control

**Status:** Accepted.

Use one peer connection with video + DataChannel.

TURN is required for reliable WAN fallback.

## ADR-004 — Narrow CDP Input allowlist

**Status:** Accepted.

Use `chrome.debugger`, but never generic peer-to-CDP RPC.

## ADR-005 — Explicit local enable

**Status:** Accepted.

Remote mode/capture requires local laptop invocation.

## ADR-006 — PWA before native app

**Status:** Accepted.

Move to native mobile only if PWA keyboard/background limitations materially block use.

## ADR-007 — Hono + Bun signaling

**Status:** Accepted for MVP.

Protocol/domain packages remain runtime-neutral.

## ADR-008 — WebCrypto device identities

**Status:** Accepted.

Use P-256 keys plus one-time pairing proof rather than permanent plaintext shared bearer tokens.

## ADR-009 — One active tab/one phone

**Status:** Accepted for MVP.

Schemas may support multiple devices later, but concurrency is intentionally limited.

## ADR-010 — No audio

**Status:** Accepted for MVP.

Text-oriented remote ChatGPT use is the validation target.

## ADR-011 — Keep system, not display, awake

**Status:** Accepted.

Use `requestKeepAwake("system")`.

## ADR-012 — Target-site independence

**Status:** Accepted.

The MVP control plane should not branch on `chatgpt.com`.

Target-specific behavior requires a new product/policy decision.

## ADR-013 — Capture via popup user gesture + offscreen consumption

**Status:** Accepted (issue #006, verified against current stable Chrome).

`chrome.tabCapture.getMediaStreamId()` requires a local user gesture. The popup obtains the streamId inside the Enable Remote click handler and passes it to the service worker; the offscreen document consumes it with `getUserMedia({ video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })`. This mirrors the official MV3 tab-capture sample. Consequences:

- capture can never start without an explicit local click (ADR-005 holds);
- the service worker and offscreen document have no privileged media role of their own;
- a streamId is single-use and short-lived, so it is never persisted.

## ADR-014 — `capture` is a first-class field of session state

**Status:** Accepted (issue #006).

The MediaStream lifecycle (`idle | starting | active | error`) is tracked next to the peer phase instead of being conflated with it, because capture can be active while no peer has connected yet. Capture failure is fail-closed: it tears the whole session down.
