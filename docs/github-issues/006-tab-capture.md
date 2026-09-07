# Implement user-initiated active-tab video capture

**Suggested labels:** area:extension, area:webrtc, type:feature, priority:P0, needs-manual-evidence  
**Dependencies:** #005  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Capture the selected active tab only after local user invocation.

## Scope

- Use current Chrome tabCapture API.
- Obtain/consume media stream in an appropriate extension context.
- Expose capture lifecycle state.
- Stop all tracks on teardown.
- Handle target-tab close and navigation.
- Surface useful capture errors.

## Acceptance criteria

- [ ] Capture never starts at browser startup.
- [ ] Capture requires extension user invocation.
- [ ] A video MediaStreamTrack reaches the WebRTC layer.
- [ ] Navigation does not leak duplicate tracks.
- [ ] Tab close causes teardown.
- [ ] Stop ends every media track.
- [ ] Manual evidence records Chrome version and OS.

## Notes / non-goals

Use a neutral local test page for validation.
