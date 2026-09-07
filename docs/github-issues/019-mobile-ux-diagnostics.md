# Polish mobile remote-control UX and connection diagnostics

**Suggested labels:** area:pwa, area:ux, type:feature, priority:P1  
**Dependencies:** #010, #011, #016, #017  
**Milestone:** M3 — WAN readiness and MVP gate

## Goal

Make the MVP usable from a real phone without developer tools.

## Scope

- Pointer/Scroll mode controls.
- Keyboard bottom sheet.
- Viewer zoom/fullscreen.
- Connection status chip.
- Reconnect UI.
- Advanced direct/TURN/RTT/video diagnostics.
- Safe-area/orientation handling.
- PWA install UX.

## Acceptance criteria

- [ ] Controls are usable one-handed.
- [ ] Remote-input active/paused state is obvious.
- [ ] Reconnect does not queue accidental old taps.
- [ ] Android Chrome manual pass is recorded.
- [ ] iOS Safari/PWA result is documented.
- [ ] Diagnostics contain no prompt content.

## Notes / non-goals

Connection engineering details should stay in an advanced panel.
