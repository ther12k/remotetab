# Security & Threat Model

## 1. Security objective

A paired phone may temporarily control one user-selected Chrome tab but must not obtain laptop browser authentication material.

## 2. Protected assets

Highest sensitivity:

1. browser profile/session credentials;
2. ChatGPT cookies/tokens;
3. visible page content;
4. typed user input;
5. device private keys;
6. remote-control authorization.

## 3. Actors

- legitimate owner;
- network attacker;
- compromised signaling service;
- stolen paired phone;
- malicious selected webpage;
- malicious extension dependency.

## 4. Hard boundaries

### Never export browser credentials

Forbidden:

- `chrome.cookies`;
- CDP cookie extraction;
- browser profile filesystem access;
- auth extraction from page storage;
- interception/forwarding of auth headers.

### No automatic ChatGPT output extraction

No:

- assistant DOM parsing;
- conversation scraping;
- structured response API;
- bulk export.

### No arbitrary CDP RPC

Phone sends product-level input messages only.

### Explicit local activation

Remote access cannot silently start in background.

### One selected tab

MVP cannot remotely switch target tabs without local re-activation.

## 5. Threats and controls

### Pairing-code theft

Controls:

- 256-bit secret;
- <=5-minute TTL;
- one use;
- cancel;
- show peer identity/fingerprint;
- consume secret after success.

### Signaling MITM/compromise

Controls:

- QR binds desktop public key;
- pairing proof binds phone key;
- peers store each other's public keys;
- fresh mutual challenge over DataChannel before enabling control.

### Replay

Controls:

- unique session id;
- monotonic sequence;
- fresh challenge each peer connection;
- stale session rejection.

### Stolen paired phone

Controls:

- device list;
- revoke;
- active revoke disconnects;
- optional biometric/local re-auth later.

### TURN compromise

Use time-limited TURN credentials. TURN carries encrypted WebRTC packets.

### Extension supply chain

Controls:

- minimal dependencies;
- lockfile;
- no remote code;
- dependency/secret scan;
- reproducible build documentation.

### Debugger/keep-awake leaks

Use centralized idempotent teardown and lifecycle tests.

### Input flood

Use:

- message size bounds;
- sequence validation;
- DataChannel backpressure;
- pointer coalescing;
- session stop on protocol abuse.

### Sensitive logs

Never log:

- prompt text;
- frames;
- private keys;
- pairing secret;
- raw production SDP by default;
- sensitive URL query/fragment.

## 6. Expected extension permissions

As needed:

```text
activeTab
tabCapture
debugger
storage
power
offscreen
```

Avoid:

```text
cookies
webRequest
webRequestBlocking
history
nativeMessaging
<all_urls>
```

unless a future ADR proves necessity.

## 7. Crypto

Use WebCrypto primitives only:

- random: `crypto.getRandomValues`;
- signing: ECDSA P-256 + SHA-256;
- pairing proof: HMAC-SHA-256;
- fingerprint: SHA-256;
- transport: browser WebRTC security;
- signaling: TLS/WSS.

## 8. Policy boundary

OpenAI Terms of Use effective January 1, 2026 currently prohibit automatically/programmatically extracting data or Output.

RemoteTab therefore deliberately excludes ChatGPT output scraping.

This reduces one policy risk but is not legal advice. Re-review target-site terms and Chrome distribution policy before public launch.

## 9. Release security gates

```text
[ ] unpaired phone cannot reach REMOTE_ACTIVE
[ ] wrong peer key fails
[ ] expired/reused QR fails
[ ] revoked peer fails
[ ] replayed/stale control fails
[ ] arbitrary CDP unavailable
[ ] no chrome.cookies usage
[ ] no ChatGPT output selectors
[ ] production logs contain no prompt/video/credential data
[ ] TURN credentials are time limited
[ ] Stop releases debugger
[ ] Stop releases keep-awake
[ ] target-tab close tears down session
```
