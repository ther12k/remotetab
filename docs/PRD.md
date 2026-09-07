# Product Requirements Document — RemoteTab MVP

## 1. Product summary

RemoteTab lets a user remotely interact with one browser tab already open and authenticated on their own laptop.

The motivating use case is continuing an existing ChatGPT web conversation from a phone while preserving the exact laptop web session, project/conversation state, and web-only features, without signing the phone into ChatGPT.

RemoteTab behaves like a purpose-built remote tab viewer/controller.

## 2. Problem

Generic remote desktop works but is awkward on a phone because it streams an entire desktop.

A separate API client does not preserve the same browser session or web-only product behavior.

A DOM-scraping wrapper is fragile and creates policy/security risk.

RemoteTab therefore leaves the browser as the source of truth and forwards only tab media and direct user input.

## 3. Product principles

1. **Laptop is the trust anchor.** Browser authentication remains on the laptop.
2. **Pixels out, human input in.** No automatic output extraction.
3. **Explicit local consent.** Remote mode begins only after a local extension action.
4. **Page agnostic.** No ChatGPT selectors in the control plane.
5. **Fail closed.** Auth/protocol/capture uncertainty disables control.
6. **Minimal relay trust.** Signaling coordinates peers; media/control use WebRTC.

## 4. Primary persona

A user who owns both laptop and phone and wants to continue an existing web session remotely.

Needs:

- fast pairing;
- mobile-friendly typing;
- usable touch/scroll;
- clear connection state;
- confidence that browser credentials never move to the phone.

## 5. Jobs to be done

- Continue the exact web conversation/session remotely.
- Keep the ChatGPT login isolated to the laptop.
- Control the tab comfortably from a phone instead of a tiny full-desktop UI.

## 6. Functional requirements

### FR-001 Extension shell

The Manifest V3 extension must show:

- current active tab;
- Remote Mode state;
- paired phone(s);
- Enable Remote;
- Stop Remote;
- revoke controls;
- connection/capture/input errors.

### FR-002 Explicit start

Capture may begin only after the user invokes the extension locally.

No auto-capture on browser startup.

### FR-003 Tab capture

Use `chrome.tabCapture`.

MVP:

- video only by default;
- adaptive WebRTC;
- initial target around 1280x720 at 10–15 fps for text-heavy pages;
- stop all tracks on teardown.

### FR-004 Pairing

Pair a phone using a short-lived QR session.

Requirements:

- >=256-bit random secret;
- <=5-minute expiry;
- one use;
- phone and laptop each create their own device key;
- peer public keys stored only after successful proof;
- pairing revocable from laptop.

### FR-005 Signaling

A WSS service relays:

- device presence;
- pairing;
- offer/answer;
- ICE;
- reconnect/session coordination.

It must never receive ChatGPT cookies or scraped page output.

### FR-006 WebRTC

Laptop sends captured-tab video.

Phone receives video.

Control uses a reliable ordered DataChannel.

Configured TURN must support cases where direct connectivity fails.

### FR-007 Control messages

Minimum:

```text
pointer.move
pointer.down
pointer.up
wheel
key.down
key.up
text.insert
viewport.sync
ping/pong
session.stop
```

### FR-008 Page-agnostic input

Use `chrome.debugger` with a hardcoded CDP allowlist for direct input and geometry.

No remote caller may choose arbitrary CDP method names.

### FR-009 Mobile keyboard

Phone exposes a keyboard bridge for the currently focused remote element.

Support:

- normal text;
- Enter;
- Backspace/Delete;
- arrows;
- Tab;
- common modifiers;
- bounded paste/text insertion.

IME/emoji limitations must be documented if full fidelity is not stable.

### FR-010 Touch and scroll

Support:

- tap;
- pointer mode;
- scroll mode;
- coordinate mapping with letterboxing;
- viewer zoom that does not unintentionally zoom the remote page.

### FR-011 Keep awake

While Remote Mode is active, extension may request:

```text
chrome.power.requestKeepAwake("system")
```

It must release the request during teardown.

### FR-012 Reconnect

On short network loss:

- input freezes;
- a new peer connection is created;
- peer identity is revalidated;
- old session messages are rejected;
- normal reconnect should not require re-pairing.

### FR-013 Stop/revoke

Laptop:

- stop session;
- revoke phone;
- clear pairings.

Phone:

- disconnect;
- forget laptop.

Revocation invalidates subsequent peer authentication.

### FR-014 No credential export

The codebase must not use:

- `chrome.cookies`;
- ChatGPT auth extraction;
- cookie forwarding;
- browser profile copying;
- ChatGPT network-response interception.

## 7. Non-functional requirements

### Security

- TLS/WSS for signaling.
- WebRTC encrypted media/data.
- strict runtime schemas.
- replay/stale-message rejection.
- rate and message-size bounds.

### Privacy

Production logs must not contain:

- captured frames;
- typed prompt contents;
- pairing secrets;
- private keys;
- raw SDP by default;
- sensitive URL query/fragment values.

### Performance targets

Engineering targets, not guarantees:

- first video frame within 5 seconds after successful peer connection;
- RemoteTab control processing overhead p50 <50 ms excluding network/browser rendering;
- no unbounded input queues;
- 60-minute sustained session without runaway resource growth.

### Compatibility

Release must record actual tested versions.

Target:

- current stable desktop Chrome;
- Android Chrome PWA;
- iOS Safari/PWA tested and explicitly marked supported/beta/unsupported;
- Windows/macOS/Linux status recorded, not assumed.

## 8. UX states

Laptop:

```text
Idle -> Pairable/Enabled -> Signaling -> Authenticating -> Connected -> Stopping
```

Phone:

```text
Unpaired -> Pairing -> Paired -> Connecting -> Authenticating -> Viewing
```

Input must be disabled outside authenticated `Viewing/Connected`.

## 9. Product/policy boundary

The MVP must not implement:

- ChatGPT assistant DOM parsing;
- automatic output extraction;
- conversation export;
- background prompt loops;
- anti-rate-limit/anti-bot bypass;
- ChatGPT API emulation.

OpenAI's current consumer Terms prohibit automatic/programmatic extraction of data or Output. The architecture intentionally avoids that behavior. This is a design choice, not legal advice; re-check target-service terms before public release.

## 10. MVP success

Technical:

- controlled network matrix connection success >=95%;
- direct and TURN tests pass;
- 60-minute soak passes;
- unpaired/revoked/replayed control fails;
- all credential-leak guard checks pass.

Product:

- a new user can pair without developer tooling;
- user can complete a real ChatGPT turn through the remote pixels/input path;
- user can revoke a phone and confirm it cannot reconnect.

## 11. Release blockers

Any unresolved issue that can:

- leak browser credentials;
- allow an unpaired device to control a tab;
- expose arbitrary CDP commands;
- leave debugger/keep-awake attached after teardown;
- leak page content through logs;
- introduce automatic ChatGPT output extraction;

blocks release.
