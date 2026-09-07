# GitHub Milestones, Labels & Dependency Plan

## Milestones

### M0 — Repository foundation

- #001 Bootstrap monorepo
- #002 Protocol schemas
- #003 Device crypto
- #004 Signaling skeleton

### M1 — Local remote-control vertical slice

- #005 Extension shell/permissions
- #006 Active-tab capture
- #007 Extension WebRTC sender
- #008 Mobile PWA receiver
- #009 CDP input adapter
- #010 Pointer/scroll bridge
- #011 Keyboard bridge
- #012 Central teardown + keep-awake

### M2 — Secure pairing and sessions

- #013 QR pairing
- #014 Peer authentication
- #015 Device revocation
- #016 Secure reconnect + replay guard

### M3 — WAN readiness and MVP gate

- #017 STUN/TURN
- #018 Signaling hardening
- #019 Mobile UX/diagnostics
- #020 Release gate

## Suggested labels

```text
area:extension
area:pwa
area:signaling
area:protocol
area:crypto
area:webrtc
area:infra
area:security
area:ux
area:test

priority:P0
priority:P1
priority:P2

type:feature
type:chore
type:test
type:security
type:docs

status:blocked
needs-manual-evidence
```

## Dependency graph

```text
001
 ├── 002 ───────────────┐
 ├── 003 ──────┐        │
 ├── 004 ──────┼── 013 ─┼── 014 ── 015 ── 016
 └── 005 ──────┤        │
                ├── 006 ── 007 ── 008
                ├── 009 ── 010
                │       └── 011
                └────────── 012

016 ── 017 ── 019 ── 020
004 ── 018 ───────────┘
```

## Critical path

```text
001
 -> 002/003/004/005
 -> 006
 -> 007
 -> 008/009
 -> 010/011
 -> 012
 -> 013
 -> 014
 -> 015/016
 -> 017/018
 -> 019
 -> 020
```

## Safe parallel work

Early parallel:

- #002 protocol
- #003 crypto
- #004 signaling
- #005 extension shell

Later:

- #008 PWA can progress while #009 input adapter is built.

Do not parallelize secure pairing/reconnect before protocol/crypto contracts are stable.

## Issue-closing rule

Every issue closes only with:

1. implementation;
2. relevant automated tests;
3. typed/user-readable errors;
4. docs changes if behavior changed;
5. manual evidence instructions for browser-only behavior;
6. no unrelated refactor;
7. acceptance criteria checked explicitly.
