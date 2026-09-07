# RemoteTab Control & Signaling Protocol v1

## Transport

- WSS for signaling.
- WebRTC video track for the selected tab.
- Reliable ordered DataChannel `control.v1` for input/auth/session events.
- Optional low-priority `health.v1` channel for RTT/health telemetry.

## Envelope

```json
{
  "v": 1,
  "sessionId": "01J...",
  "seq": 42,
  "ts": 1788800000000,
  "type": "pointer.down",
  "payload": {}
}
```

Validation:

- `v === 1`;
- session id equals current session;
- `seq` is monotonically increasing;
- serialized message size is bounded;
- strict schema for each message;
- unknown messages rejected.

## Control messages

### `pointer.move`

```json
{"x":0.52,"y":0.81}
```

Normalized 0..1 coordinates.

### `pointer.down` / `pointer.up`

```json
{
  "x":0.52,
  "y":0.81,
  "button":"left",
  "clickCount":1
}
```

### `wheel`

```json
{
  "x":0.5,
  "y":0.5,
  "deltaX":0,
  "deltaY":382
}
```

### `key.down` / `key.up`

```json
{
  "key":"Enter",
  "code":"Enter",
  "modifiers":0
}
```

### `text.insert`

```json
{"text":"hello"}
```

Bound length. The extension chooses the safe CDP compatibility strategy.

### `viewport.request`

Empty payload.

### `viewport.sync`

Laptop -> phone:

```json
{
  "cssWidth":1440,
  "cssHeight":900,
  "deviceScaleFactor":2
}
```

### `session.stop`

```json
{"reason":"user"}
```

## Peer authentication

Before control is enabled:

### `peer.challenge`

```json
{
  "nonce":"base64url...",
  "sessionId":"..."
}
```

### `peer.proof`

```json
{
  "deviceId":"...",
  "publicKeyFingerprint":"...",
  "signature":"base64url..."
}
```

Signature transcript binds:

- protocol version;
- session id;
- both device ids;
- both public key fingerprints;
- role;
- challenge nonce.

## Signaling messages

```text
pair.create
pair.join
pair.accept
pair.reject

session.request
session.accept
session.reject
session.close

signal.offer
signal.answer
signal.ice

presence.ping
presence.pong
error
```

## Pairing lifecycle

```text
CREATED -> JOINED -> VERIFIED -> ACCEPTED -> CONSUMED
```

Failure:

```text
EXPIRED
CANCELLED
REJECTED
```

A consumed pairing secret never becomes valid again.

## Session lifecycle

```text
REQUESTED
 -> ACCEPTED
 -> SIGNALING
 -> PEER_CONNECTED
 -> PEER_AUTHENTICATED
 -> ACTIVE
 -> CLOSING
 -> CLOSED
```

Only `ACTIVE` accepts input.

## Backpressure

Priority:

1. auth/session;
2. key/button transitions;
3. text;
4. wheel;
5. pointer move;
6. health.

Pointer/wheel events may be coalesced. Key/button down/up may not silently drop.

## Error codes

Initial stable codes:

```text
PAIR_EXPIRED
PAIR_INVALID_PROOF
PAIR_ALREADY_USED
DEVICE_REVOKED
SESSION_NOT_FOUND
SESSION_CONFLICT
PEER_AUTH_FAILED
PROTOCOL_VERSION_UNSUPPORTED
MESSAGE_INVALID
MESSAGE_TOO_LARGE
REPLAY_REJECTED
CAPTURE_NOT_ACTIVE
INPUT_NOT_ATTACHED
TARGET_TAB_CLOSED
TURN_UNAVAILABLE
CONNECTION_LOST
```

## Versioning

Protocol version and app version are independent.

MVP supports only `v=1` and rejects unsupported versions explicitly.

## Forbidden protocol shape

Never create:

```json
{
  "type":"cdp",
  "method":"Runtime.evaluate",
  "params":{}
}
```

Remote behavior maps only to narrowly defined product-level messages.
