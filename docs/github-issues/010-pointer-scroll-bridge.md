# Implement touch, pointer, coordinate mapping, and scrolling

**Suggested labels:** area:pwa, area:extension, area:protocol, type:feature, priority:P0  
**Dependencies:** #008, #009  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Make the remote tab comfortably clickable and scrollable from a phone.

## Scope

- Calculate rendered video content rectangle.
- Send normalized coordinates.
- Synchronize target CSS viewport.
- Implement explicit Pointer and Scroll modes.
- Handle tap/double tap.
- Coalesce pointer/wheel events under load.
- Implement DataChannel backpressure.

## Acceptance criteria

- [ ] Letterboxed taps map correctly.
- [ ] Taps outside visible video are rejected.
- [ ] Coordinates map to target CSS pixels.
- [ ] Scrolling does not accidentally click.
- [ ] Pointer movement is rate-capped/coalesced.
- [ ] Button down/up is never silently dropped.
- [ ] Coordinate unit and E2E grid tests pass.

## Notes / non-goals

Viewer zoom must not silently zoom the target page.
