# Technical Stack

## Recommended MVP stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Shared types across extension/PWA/server |
| Extension | WXT + Manifest V3 | Modern extension tooling with explicit manifest control |
| Phone | React + Vite PWA | Fast mobile-web iteration and native WebRTC access |
| PWA | vite-plugin-pwa | Installable web shell |
| Signaling | Hono on Bun | Small WSS/HTTP service |
| Validation | Zod or Valibot | Strict runtime wire validation |
| Crypto | WebCrypto | No hand-rolled primitives |
| Media/control | Native WebRTC | Peer media + encrypted DataChannel |
| TURN | coturn | Mature self-hosted reference |
| DB | SQLite first; Postgres when multi-instance | Minimal metadata storage |
| Tests | Vitest + Playwright | Unit/integration/browser |
| Lint/format | Biome or ESLint+Prettier | Pick one and standardize |

## Why a PWA first

The phone needs:

- WebRTC video;
- touch/pointer;
- QR camera;
- keyboard;
- installability.

A PWA is the shortest path and avoids App Store distribution for MVP.

Use a native shell later only if iOS/IME/background limitations prove material.

## Why Hono + Bun

Signaling mainly handles:

- WSS connections;
- small REST endpoints;
- pair/session metadata;
- TURN credentials.

It does not need a large application framework.

Keep domain/protocol packages runtime-neutral so the server can move later.

## Expected extension permissions

Only as actually required:

```json
{
  "permissions": [
    "activeTab",
    "tabCapture",
    "debugger",
    "storage",
    "power",
    "offscreen"
  ]
}
```

Avoid broad host permissions.

## Core browser APIs

### `chrome.tabCapture`

Selected-tab media capture; user invocation is required.

### `chrome.debugger`

Transport for Chrome DevTools Protocol. The documented available domains include `Input`.

### CDP Input

Expected:

```text
Input.dispatchKeyEvent
Input.dispatchMouseEvent
Input.dispatchTouchEvent
Input.insertText (compatibility path)
```

### `chrome.power`

Use `"system"` to keep the system active while allowing screen-off.

### WebRTC

Use video track for display and DataChannel for input/session messages.

## Database sketch

```text
devices
  id
  public_key
  fingerprint
  display_name
  created_at
  revoked_at
  revocation_version

pairing_sessions
  id
  desktop_device_id
  verification_state
  expires_at
  consumed_at

remote_sessions
  id
  desktop_device_id
  phone_device_id
  created_at
  closed_at
  close_reason
```

Do not persist page content.

## Dependency policy

Before adding a runtime dependency:

1. can a platform API do it?
2. will it run in the privileged extension context?
3. is it maintained?
4. does it load remote code?
5. is it necessary at runtime?

Keep the privileged extension dependency graph especially small.

## Versioning

Initial suggestion:

```text
app: 0.1.0-alpha.x
protocol: 1
```
