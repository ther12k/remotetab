# Test Strategy

## Required layers

```text
unit
 -> protocol / crypto / coordinate mapping

integration
 -> signaling / peer helpers / adapter mocks

browser integration
 -> unpacked extension + neutral test page

network
 -> direct / TURN / disconnect / reconnect

manual release evidence
 -> real ChatGPT tab as pixels only
```

## Unit tests

### Protocol

Cover:

- unknown version/type;
- wrong session;
- duplicate/rollback sequence;
- malformed coordinates;
- NaN/Infinity;
- oversized text;
- invalid modifiers/buttons.

### Crypto

Cover:

- valid/wrong pairing secret;
- modified transcript;
- expired pair;
- valid/wrong peer signature;
- signature replay to different session;
- role reflection.

### Coordinate mapping

Cover:

- no letterbox;
- horizontal/vertical letterbox;
- orientation change;
- target browser zoom/device scale;
- edges/out-of-range taps.

## Signaling integration

Test:

- device connect;
- pair create/join/expire/consume;
- unauthorized route rejected;
- session request;
- offer/answer/ICE;
- max one active phone session;
- reconnect TTL;
- revoke.

## WebRTC integration

Use two browser contexts where CI permits.

Test:

- peer establishment;
- dummy video track;
- DataChannel round trip;
- close/cleanup;
- local coturn relay path.

## Extension neutral test page

Create a local page with:

- input;
- textarea;
- button;
- scroll region;
- clickable coordinate grid;
- key-event recorder.

Verify:

- target grid click;
- exact click count;
- scrolling;
- typing;
- Enter;
- detach disables input.

## Static security guard

CI must flag:

```text
chrome.cookies
Network.getAllCookies
Storage.getCookies
ChatGPT output selectors
generic phone-to-CDP RPC
```

This is a guardrail, not full review.

## PWA tests

- pairing/manual code;
- connection states;
- video aspect mapping;
- pointer/scroll modes;
- keyboard bridge;
- reconnect modal;
- revoked state;
- orientation.

## End-to-end scenarios

### E2E-01 First pair

Phone is unpaired -> QR -> peer proof -> video -> control.

### E2E-02 Existing pair

Known phone reconnects without QR after laptop enables Remote Mode.

### E2E-03 Remote text

Tap test input -> type `hello world` -> target receives exact text -> Enter.

### E2E-04 Scroll

Remote scroll changes target without accidental click.

### E2E-05 Reconnect

Drop phone network for 5–15 seconds -> input freezes -> new peer -> fresh proof -> control resumes.

### E2E-06 Revoke

Laptop revokes active phone -> session ends -> reconnect fails.

### E2E-07 Local stop

Verify:

- DataChannel closed;
- peer closed;
- tracks stopped;
- debugger detached;
- keep-awake released.

### E2E-08 Target tab close

Closing target tears down cleanly.

### E2E-09 TURN only

Force relay policy; session still works.

### E2E-10 Soak

60-minute remote session with periodic test-page interactions.

Assert no unbounded resource growth/reconnect loop.

## Real ChatGPT release test

Manual visual test only.

1. laptop is logged into ChatGPT;
2. phone is not;
3. stream tab;
4. user taps visible composer;
5. type harmless message;
6. send;
7. visually observe response via video;
8. inspect RemoteTab traffic/logs for absence of ChatGPT cookie or scraped response payload.

Do not scrape assistant text for assertions.

## Network matrix

| Laptop | Phone | Expected |
|---|---|---|
| same Wi-Fi | same Wi-Fi | direct |
| home Wi-Fi | mobile | direct or TURN |
| restrictive Wi-Fi | mobile | TURN |
| Wi-Fi -> mobile switch | active | reconnect |
| phone offline 30 sec | laptop online | bounded reconnect/fail |

## CI workflows

Suggested:

```text
ci.yml
  lint
  typecheck
  unit
  builds

browser.yml
  extension neutral-page E2E
  PWA tests

turn.yml
  local coturn test

security.yml
  forbidden API/selectors
  dependency/secret scan
```
