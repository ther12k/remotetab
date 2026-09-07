# Bootstrap RemoteTab TypeScript monorepo

**Suggested labels:** type:chore, priority:P0  
**Dependencies:** None  
**Milestone:** M0 — Repository foundation

## Goal

Create the repository structure and CI foundation used by all later work.

## Scope

- Create apps/extension, apps/mobile-web, apps/signaling.
- Create packages/protocol, crypto, webrtc, config, testkit.
- Create infra/coturn, tests/e2e, docs.
- Choose one workspace/lockfile strategy and document it.
- Enable TypeScript strict mode, lint/format, unit test runner, build scripts, dependency audit and CI.

## Acceptance criteria

- [ ] Fresh clone installs with one documented command.
- [ ] typecheck, unit tests, and builds pass.
- [ ] One lockfile is committed.
- [ ] No runtime secrets are committed.
- [ ] CI runs on pull requests.
- [ ] README documents local prerequisites and commands.

## Notes / non-goals

No real WebRTC, Chrome privileged API, or pairing implementation yet.
