# Implement mobile keyboard bridge and remote key events

**Suggested labels:** area:pwa, area:extension, area:protocol, type:feature, priority:P0  
**Dependencies:** #008, #009  
**Milestone:** M1 — Local remote-control vertical slice

## Goal

Allow phone keyboard input into whichever remote element the user focused manually.

## Scope

- Local bridge textarea/input.
- Key down/up events.
- Enter, Backspace/Delete, Tab, arrows and common modifiers.
- Bounded text insertion.
- Composition/IME detection.
- Document incompatible IME/emoji cases.

## Acceptance criteria

- [ ] Common Latin text enters correctly on neutral test page.
- [ ] Enter and Backspace work.
- [ ] Arrow keys and Tab work.
- [ ] No typed text appears in production logs.
- [ ] Large pasted input is bounded/chunked safely.
- [ ] IME/emoji behavior is tested and documented.
- [ ] No ChatGPT composer selector exists.

## Notes / non-goals

The keyboard bridge transports user input; it is not a message-history store.
