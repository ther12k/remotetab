# Release Plan

## Suggested stages

```text
0.1.0-alpha.1  first vertical slice
0.1.0-alpha.2  secure pairing + reconnect
0.1.0-beta.1   TURN + mobile UX + security
0.1.0          MVP
```

## Alpha 1 — Vertical slice

```text
[ ] extension loads unpacked
[ ] local user starts active-tab capture
[ ] PWA receives video
[ ] control DataChannel opens
[ ] neutral page receives pointer input
[ ] neutral page receives keyboard input
[ ] Stop tears down peer/capture/debugger
```

Temporary dev pairing token is allowed only at this stage.

## Alpha 2 — Real identity

```text
[ ] QR pairing
[ ] P-256 device identities
[ ] pairing proof
[ ] mutual peer challenge
[ ] revoke
[ ] reconnect with fresh auth
[ ] sequence/replay guard
[ ] production log redaction
```

All dev auth bypasses removed.

## Beta — WAN readiness

```text
[ ] configurable STUN
[ ] TURN with short-lived credentials
[ ] same-Wi-Fi test
[ ] mobile-network test
[ ] TURN-only test
[ ] network-switch reconnect
[ ] 60-minute soak
[ ] permission review
[ ] dependency/security scan
```

## MVP 0.1.0 gate

### Functional

```text
[ ] pair
[ ] known-device reconnect
[ ] capture selected tab
[ ] phone video
[ ] tap/click
[ ] scroll
[ ] keyboard
[ ] Enter/send
[ ] stop
[ ] revoke
[ ] network reconnect
```

### Security

```text
[ ] no browser credential export
[ ] no chrome.cookies
[ ] no ChatGPT DOM/output scraping
[ ] no arbitrary CDP forwarding
[ ] no control before peer auth
[ ] expired/reused pair fails
[ ] revoked peer fails
[ ] replay fails
[ ] no prompt/video/credentials in production logs
[ ] no static TURN secret in client
```

### Lifecycle

```text
[ ] debugger detached
[ ] capture tracks stopped
[ ] RTCPeerConnection closed
[ ] DataChannels closed
[ ] keep-awake released
[ ] extension restart reconciles stale state
[ ] target tab close handled
```

### Compatibility evidence

Record exact versions and results for:

- desktop Chrome;
- Android Chrome;
- iOS Safari/PWA;
- at least two desktop OSes where practical.

Do not claim untested support.

### Policy review

Before public release:

- re-read Chrome extension distribution policies;
- re-read terms for target sites;
- confirm the app remains remote display/direct user control;
- update threat model if policies changed.

## Acceptable documented MVP limitations

- IME/emoji edge cases;
- no file upload;
- no audio;
- one phone;
- one selected tab;
- laptop already on and Chrome running;
- local explicit enable required.

## Non-waivable blockers

- credential leak;
- unpaired control;
- replay acceptance;
- arbitrary CDP execution;
- content storage;
- prompt text in logs;
- broken teardown;
- hidden background capture.
