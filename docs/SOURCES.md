# Sources & External Assumptions

Verified: 2026-09-07.

Implementation agents should re-check current docs/policies when relevant.

## S1 — Chrome `tabCapture`

Chrome for Developers.

Planning assumptions:

- captures tab media;
- requires `tabCapture` permission;
- capture is user-invocation gated;
- `getMediaStreamId()` exists for obtaining a stream id.

https://developer.chrome.com/docs/extensions/reference/api/tabCapture

## S2 — Chrome `debugger`

Chrome for Developers.

Planning assumptions:

- provides CDP transport;
- requires `debugger` permission;
- can target a tab;
- supported domains include `Input`.

https://developer.chrome.com/docs/extensions/reference/api/debugger

## S3 — Chrome DevTools Protocol Input

Methods include input dispatch primitives such as keyboard/mouse/touch.

https://chromedevtools.github.io/devtools-protocol/tot/Input/

## S4 — Chrome `power`

`requestKeepAwake("system")` keeps the system active while allowing display-off.

https://developer.chrome.com/docs/extensions/reference/api/power

## S5 — WebRTC DataChannel

MDN documents bidirectional peer data channels associated with `RTCPeerConnection` and WebRTC encrypted transport.

https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels

## S6 — Hono WebSocket support

https://hono.dev/docs/helpers/websocket

## S7 — Bun WebSockets

https://bun.com/docs/runtime/http/websockets

## S8 — WXT manifests

https://wxt.dev/guide/essentials/config/manifest.html

## S9 — Vite PWA React integration

https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/frameworks/react.md

## S10 — OpenAI Terms of Use

Effective January 1, 2026.

Relevant current restriction: users may not automatically or programmatically extract data or Output.

RemoteTab intentionally excludes ChatGPT output scraping/structured extraction.

https://openai.com/policies/terms-of-use/

## Note

Browser capability does not itself mean every website permits every remote-control pattern. Re-check target-site terms and Chrome distribution rules before public distribution.
