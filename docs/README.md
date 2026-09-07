# RemoteTab — MVP Planning Bundle

RemoteTab is a mobile-first remote browser-tab controller for this first use case:

> Continue using an already-authenticated ChatGPT web session on a laptop from a phone, without logging the phone into ChatGPT and without moving the ChatGPT session cookie off the laptop.

The MVP is deliberately **remote display + direct human input**, not a scraper or unofficial ChatGPT API.

## Core invariant

```text
Laptop selected tab -> WebRTC video -> phone
Phone human input   -> WebRTC DataChannel -> laptop selected tab
```

The phone must never receive ChatGPT credentials, cookies, bearer tokens, automatically extracted assistant output, DOM snapshots, or hidden application state.

## Recommended stack

- Chrome Manifest V3 extension.
- WXT + TypeScript.
- `chrome.tabCapture` for selected-tab video.
- `chrome.debugger` + CDP Input for narrow page-agnostic remote input.
- WebRTC video plus reliable DataChannel.
- React + Vite PWA on the phone.
- Hono on Bun for WSS signaling.
- WebCrypto P-256 device identities.
- Configurable STUN/TURN; coturn as reference TURN.
- `chrome.power.requestKeepAwake("system")` while Remote Mode is active.

## Bundle contents

- `PRD.md`
- `MVP_SCOPE.md`
- `ARCHITECTURE.md`
- `MVP_IMPLEMENTATION_BLUEPRINT.md`
- `SECURITY_THREAT_MODEL.md`
- `CONTROL_PROTOCOL.md`
- `UX_FLOWS.md`
- `TECH_STACK.md`
- `TEST_STRATEGY.md`
- `RELEASE_PLAN.md`
- `ADR.md`
- `GITHUB_MILESTONES.md`
- `GITHUB_ISSUE_IMPORT.md`
- `AGENT_HANDOFF_PROMPT.md`
- `SOURCES.md`
- `github-issues/*.md`

## MVP definition

A user can install the extension, locally enable one already-open tab, pair a phone by QR, see the real tab on the phone, tap/scroll/type into it, complete a ChatGPT turn through the actual web UI, disconnect, and revoke the phone.

There must be no ChatGPT DOM/output scraping.
