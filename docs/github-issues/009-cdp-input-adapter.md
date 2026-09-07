# Implement narrow Chrome debugger/CDP input adapter

**Suggested labels:** area:extension, area:security, type:feature, priority:P0, needs-manual-evidence  
**Dependencies:** #002, #005  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Dispatch page-agnostic remote human input without exposing arbitrary debugger capability.

## Scope

- Attach/detach chrome.debugger to selected tab.
- Get target viewport geometry.
- Mouse move/down/up.
- Wheel.
- Key down/up.
- Bounded safe text-insertion compatibility path.
- Handle debugger onDetach and attach conflicts.

## Acceptance criteria

- [ ] No peer-controlled generic `sendCommand()` exists.
- [ ] Phone cannot choose CDP method names.
- [ ] Only hardcoded allowed operations are mapped.
- [ ] Attach errors are user-readable.
- [ ] Central teardown detaches debugger.
- [ ] Neutral test page receives exact click/key events.
- [ ] Negative test proves arbitrary command is impossible.

## Notes / non-goals

Do not use DOM selectors or arbitrary Runtime.evaluate from the phone.
