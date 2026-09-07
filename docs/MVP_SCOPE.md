# MVP Scope

## Goal

Prove one laptop + one selected Chrome tab + one paired phone.

Required:

- video;
- tap/pointer;
- scroll;
- keyboard;
- secure pairing;
- reconnect;
- explicit stop/revoke.

First demonstration: an existing ChatGPT web conversation.

## In scope

### Laptop extension

- Manifest V3 / WXT.
- active-tab target.
- local user-initiated capture.
- WebRTC sender.
- CDP Input adapter.
- peer pairing storage.
- keep-awake while enabled.
- popup status and stop/revoke.

### Phone PWA

- QR pairing;
- WebRTC receiver;
- viewer;
- touch mapping;
- keyboard bridge;
- reconnect/disconnect;
- device storage.

### Signaling

- Hono/Bun WSS;
- ephemeral pair/session routing;
- rate limits;
- no content storage;
- configurable ICE/TURN credential endpoint.

## Explicitly excluded

- ChatGPT DOM/output scraping.
- Cookie/session export.
- Automation/macros/schedules.
- Full-desktop control.
- File transfer.
- Voice/tab audio.
- Browser startup or laptop wake.
- Multi-laptop/multi-phone simultaneous routing.
- Recording/history/OCR.
- Native mobile app.

## Supported journey

```text
Laptop:
open ChatGPT
 -> click extension
 -> Enable Remote
 -> pair/accept phone

Phone:
open PWA
 -> scan QR or choose paired laptop
 -> connect
 -> view tab
 -> tap visible composer
 -> keyboard bridge
 -> type
 -> Enter
 -> watch response render

Laptop:
Stop Remote / revoke
```

## MVP release demonstration

Show:

1. laptop tab already authenticated;
2. phone not authenticated to ChatGPT;
3. pair succeeds;
4. tab video streams;
5. user remotely types and submits;
6. response appears as video;
7. RemoteTab network/log inspection shows no ChatGPT credential or structured scraped response;
8. stop cleans session;
9. revoked phone cannot reconnect.
