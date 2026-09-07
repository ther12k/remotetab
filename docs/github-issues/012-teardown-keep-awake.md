# Centralize session teardown and keep-awake lifecycle

**Suggested labels:** area:extension, area:security, type:feature, priority:P0  
**Dependencies:** #006, #007, #009  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Guarantee that every stop/error path leaves the browser and laptop clean.

## Scope

- Create one idempotent `stopRemoteSession(reason)` orchestrator.
- Request `chrome.power.requestKeepAwake("system")` only while Remote Mode is active.
- On teardown block input, close DataChannels/peer, stop tracks, detach debugger, release keep-awake, close signaling and clear ephemeral state.
- Reconcile stale state after extension restart.

## Acceptance criteria

- [ ] Calling teardown twice is safe.
- [ ] Local Stop cleans all resources.
- [ ] Target tab close cleans all resources.
- [ ] Debugger detach event reconciles state.
- [ ] Keep-awake is released.
- [ ] Failure injection at each teardown step still attempts remaining cleanup.

## Notes / non-goals

This issue is a release-blocking lifecycle foundation.
