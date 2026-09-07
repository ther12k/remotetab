# Architecture

## 1. Overview

```text
┌───────────────────┐                 ┌──────────────────────┐
│ Phone PWA         │                 │ Chrome Extension     │
│ React + WebRTC    │<=============== >│ tabCapture + CDP     │
│                   │  WebRTC         │ power + peer auth    │
└─────────┬─────────┘                 └──────────┬───────────┘
          │                                    │
          │ WSS signaling                     ▼
          │                         ┌──────────────────────┐
          ▼                         │ Selected Chrome tab  │
┌───────────────────┐               │ e.g. chatgpt.com     │
│ Signaling Service │               │ already authenticated│
│ Hono + Bun        │               └──────────────────────┘
└───────────────────┘

Optional network path:
Phone <-> TURN <-> Extension
(WebRTC packets remain transport-encrypted)
```

## 2. Trust boundaries

### Browser account boundary

ChatGPT/browser authentication exists only in the laptop profile.

### Extension boundary

The extension is privileged and must remain small. It has capture/debugger/power capabilities.

### Phone boundary

A phone is trusted only after explicit pairing and peer proof.

### Signaling boundary

Treat the internet-facing relay as potentially observable/compromisable.

It receives signaling metadata, not ChatGPT credentials or scraped content.

## 3. Extension components

### Service worker

Owns:

- target tab id;
- remote/session state;
- signaling coordination;
- debugger attach/detach;
- keep-awake lifecycle;
- pair/device state.

### Offscreen/media context

Use where needed because a MV3 service worker is not the right place for long-lived media.

Owns:

- tab MediaStream;
- `RTCPeerConnection`;
- media tracks;
- DataChannel;
- WebRTC stats/timers.

### Popup

UI only:

- target;
- enable/stop;
- pair/revoke;
- connection status;
- clear errors.

## 4. Capture flow

```text
Local user click
 -> choose active tab
 -> chrome.tabCapture.getMediaStreamId(...)
 -> extension/offscreen context consumes stream
 -> MediaStreamTrack(video)
 -> RTCPeerConnection.addTrack()
```

The exact MV3 implementation must be verified on current stable Chrome.

## 5. Input flow

```text
phone touch/key
 -> protocol envelope
 -> RTCDataChannel
 -> strict schema validation
 -> session/sequence guard
 -> coordinate mapper
 -> narrow RemoteInputAdapter
 -> chrome.debugger.sendCommand(...)
```

## 6. CDP allowlist

Expected MVP methods:

```text
Input.dispatchKeyEvent
Input.dispatchMouseEvent
Input.dispatchTouchEvent   (if used)
Input.insertText           (compatibility path only)
Page.getLayoutMetrics      (geometry)
```

Never expose generic CDP passthrough from phone.

## 7. Coordinate mapping

Phone sends normalized values `[0..1]`.

Account for the actual rendered video rectangle, not the outer element.

```text
nx = (tapX - videoLeft) / renderedVideoWidth
ny = (tapY - videoTop)  / renderedVideoHeight

remoteX = nx * targetCssViewportWidth
remoteY = ny * targetCssViewportHeight
```

Reject letterbox/out-of-range input and clamp final CSS coordinates.

## 8. Device identity

Each device creates an ECDSA P-256 signing key using WebCrypto.

Store:

- own private key locally;
- peer public key/fingerprint;
- device id;
- revocation metadata.

Never store browser credentials.

## 9. Pairing

1. laptop creates 256-bit one-time secret;
2. QR contains signaling origin, desktop id/public key/fingerprint, expiry, secret;
3. preferably place secret in URL fragment;
4. phone creates its key;
5. phone HMAC proof binds both device identities;
6. laptop verifies and stores phone public key;
7. phone stores laptop public key;
8. pairing secret is consumed/destroyed.

## 10. Session peer proof

After DataChannel opens:

1. exchange random challenge;
2. each side signs a transcript containing protocol/session/device ids/fingerprints/role/nonce;
3. verify peer public key;
4. enable control only after mutual success.

## 11. State machine

Laptop:

```text
IDLE
 -> ENABLED
 -> SIGNALING
 -> PEER_CONNECTED
 -> AUTHENTICATING
 -> REMOTE_ACTIVE
 -> RECONNECTING
 -> STOPPING
 -> IDLE
```

Failure from auth or protocol:

```text
AUTHENTICATING/REMOTE_ACTIVE -> STOPPING -> IDLE
```

## 12. Reconnect

On reconnect:

- create new peer connection;
- fresh session id/epoch;
- fresh peer challenge;
- reset sequence for new session;
- reject all old-session envelopes.

Paired public identities persist; SDP/ICE/session secrets do not.

## 13. TURN

Reliable WAN use requires TURN fallback.

Reference production deployment:

- coturn;
- time-limited credentials issued by signaling service;
- no static TURN password in extension/PWA.

## 14. Keep-awake

Request `"system"` only while Remote Mode is enabled.

Central teardown must:

1. block input;
2. close channels/peer;
3. stop tracks;
4. detach debugger;
5. release keep-awake;
6. close signaling session;
7. clear ephemeral state.

Teardown must be idempotent.

## 15. Data retention

Allowed:

- device public key/fingerprint;
- device id/name;
- revocation;
- coarse session metadata.

Not stored:

- captured video;
- prompt text;
- ChatGPT output;
- ChatGPT credentials;
- private keys on server;
- production SDP logs.

## 16. Architecture rejection rules

Reject a PR that adds, without a new approved ADR:

- ChatGPT DOM selectors;
- `chrome.cookies`;
- browser-token extraction;
- generic CDP RPC;
- remote automatic capture start;
- content recording;
- static TURN client secret.
