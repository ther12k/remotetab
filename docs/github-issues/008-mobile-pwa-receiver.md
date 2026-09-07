# Build mobile PWA WebRTC receiver and remote-tab viewer

**Suggested labels:** area:pwa, area:webrtc, area:ux, type:feature, priority:P0  
**Dependencies:** #001, #002, #004, #007  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Create an installable phone client that receives and renders the selected tab.

## Scope

- React/Vite PWA shell.
- Signaling client.
- RTCPeerConnection receiver.
- Remote video element.
- Connection state UI.
- Portrait/landscape and fullscreen behavior.
- PWA install metadata.

## Acceptance criteria

- [ ] Production configuration uses HTTPS/WSS.
- [ ] PWA receives offer and sends answer.
- [ ] Incoming video renders.
- [ ] Viewer exposes measurable rendered-content rectangle for coordinate mapping.
- [ ] Disconnected/degraded state is visible.
- [ ] Android install test is documented.
- [ ] iOS Safari/PWA result is recorded.

## Notes / non-goals

No ChatGPT-specific UI parsing.
