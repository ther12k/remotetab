# Create Manifest V3 extension shell and permission UX

**Suggested labels:** area:extension, area:ux, type:feature, priority:P0  
**Dependencies:** #001  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Build the privileged laptop shell with clear local controls.

## Scope

- WXT project with service worker/background and popup.
- Optional offscreen entrypoint scaffold.
- Typed session state store.
- Display active tab title and sanitized origin.
- Enable Remote, Stop Remote, pair/revoke placeholders.
- User-facing explanation for capture/debugger/power permissions.

## Acceptance criteria

- [ ] Loads unpacked on current stable Chrome.
- [ ] No `<all_urls>` host permission unless proven necessary.
- [ ] No `cookies` permission.
- [ ] Enable Remote is an explicit local action.
- [ ] Stop is visible whenever Remote Mode is active.
- [ ] Build contains no remote-loaded code.
- [ ] Permission rationale is documented.

## Notes / non-goals

Do not implement hidden/background auto-start.
