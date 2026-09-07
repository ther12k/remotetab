# MVP Implementation Blueprint

## 1. Proposed monorepo

```text
remotetab/
├─ apps/
│  ├─ extension/
│  ├─ mobile-web/
│  └─ signaling/
├─ packages/
│  ├─ protocol/
│  ├─ crypto/
│  ├─ webrtc/
│  ├─ config/
│  └─ testkit/
├─ infra/
│  └─ coturn/
├─ docs/
└─ tests/e2e/
```

Use one workspace strategy and one committed lockfile.

## 2. Package boundaries

### `@remotetab/protocol`

Only schemas, types, versioning, sequence validation, state helpers.

No browser APIs.

### `@remotetab/crypto`

Only WebCrypto wrappers:

- key generation/import/export;
- fingerprint;
- HMAC pairing proof;
- challenge sign/verify;
- random/base64url helpers.

### `@remotetab/webrtc`

- peer factory;
- ICE config;
- offer/answer;
- DataChannel;
- stats.

No UI.

### `apps/extension`

- popup;
- service worker;
- offscreen media host;
- capture adapter;
- debugger input adapter;
- power adapter;
- device storage.

### `apps/mobile-web`

- PWA;
- QR scanner/manual code;
- remote video;
- touch overlay;
- keyboard bridge;
- connection diagnostics.

### `apps/signaling`

- WSS;
- pair/session routing;
- rate limits;
- TURN credentials;
- health/readiness.

No media proxy.

## 3. Protocol envelope

```ts
type Envelope<T extends string, P> = {
  v: 1;
  sessionId: string;
  seq: number;
  ts: number;
  type: T;
  payload: P;
};
```

Rules:

- exact version;
- exact active session;
- monotonically increasing sequence;
- bounded serialized size;
- strict payload schema;
- unknown type rejected.

## 4. Remote input adapter

Expose only:

```ts
interface RemoteInputAdapter {
  attach(tabId: number): Promise<void>;
  detach(): Promise<void>;
  getViewport(): Promise<{ width: number; height: number }>;
  pointerMove(input: NormalizedPointer): Promise<void>;
  pointerDown(input: NormalizedPointerButton): Promise<void>;
  pointerUp(input: NormalizedPointerButton): Promise<void>;
  wheel(input: NormalizedWheel): Promise<void>;
  keyDown(input: RemoteKey): Promise<void>;
  keyUp(input: RemoteKey): Promise<void>;
  insertText(text: string): Promise<void>;
}
```

Never expose `sendCommand(method: string, params: unknown)` to peer handlers.

## 5. Capture adapter

```ts
interface TabCaptureAdapter {
  start(tabId: number): Promise<MediaStream>;
  stop(): Promise<void>;
  state(): "idle" | "starting" | "active" | "error";
}
```

Stop every track during teardown.

## 6. WebRTC shape

Laptop:

```ts
const pc = new RTCPeerConnection({ iceServers });
pc.addTrack(videoTrack, stream);

const control = pc.createDataChannel("control.v1", {
  ordered: true
});
```

Optional `health.v1` may be lossy for RTT telemetry.

## 7. Control backpressure

Priority:

1. auth/session/error;
2. key/button transitions;
3. text;
4. wheel;
5. pointer move;
6. health.

Coalesce/drop stale pointer moves.

Never silently drop key/button down/up transitions.

## 8. Keyboard strategy

PWA bottom-sheet textarea captures:

- input/beforeinput;
- keydown;
- composition events.

Use stable key dispatch for common control keys.

Use bounded text insertion compatibility path where needed.

Document IME/emoji limitations rather than corrupt input silently.

## 9. Signaling message families

```text
hello/auth
pair.create/join/accept/reject
session.request/accept/reject/close
signal.offer/answer/ice
presence/heartbeat
error
```

## 10. Pairing transcript

Bind:

```text
domain separator
protocol version
desktop device id
phone device id
desktop fingerprint
phone fingerprint
expiry
nonce
```

Phone proves knowledge of the one-time pairing secret using HMAC-SHA-256.

## 11. Peer challenge transcript

Bind:

```text
domain separator
protocol version
session id
both device ids
both fingerprints
challenge nonce
role
```

Sign using ECDSA P-256/SHA-256.

## 12. Environment

Signaling:

```text
PUBLIC_ORIGIN
DATABASE_URL
TURN_SECRET
TURN_URLS
ALLOWED_ORIGINS
LOG_LEVEL
PAIRING_TTL_SECONDS=300
RECONNECT_TTL_SECONDS=60
```

Never send `TURN_SECRET` to clients.

## 13. First vertical slice

Before UI polish:

```text
unpacked extension
 -> local enable
 -> capture neutral test tab
 -> signaling
 -> PWA receives video
 -> DataChannel
 -> remote click
 -> remote typing
 -> stop cleans capture/peer/debugger/power
```

Use a neutral local test page before ChatGPT.

## 14. Static policy guards

CI should flag:

```text
chrome.cookies
Network.getAllCookies
Storage.getCookies
[data-message-author-role
generic peer-to-CDP method forwarding
```

These checks are guardrails, not substitutes for review.
