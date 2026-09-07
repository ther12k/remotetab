# RemoteTab

Control **one already-open Chrome tab** on your laptop from a paired phone PWA over WebRTC — built for continuing an authenticated ChatGPT web session without ever moving browser credentials off the laptop.

```text
Chrome tab -> chrome.tabCapture -> WebRTC video -> phone PWA
Phone input -> WebRTC DataChannel -> strict protocol -> narrow CDP Input adapter -> tab
```

RemoteTab is deliberately **remote display + direct human input**. It never scrapes ChatGPT DOM/output, never exports cookies or tokens, and never exposes generic CDP. See [docs/SECURITY_THREAT_MODEL.md](docs/SECURITY_THREAT_MODEL.md).

## Repository layout

```text
apps/
  extension/    Chrome MV3 extension (WXT): capture, WebRTC sender, CDP input adapter
  mobile-web/   Phone PWA (React + Vite): viewer, touch/keyboard bridges
  signaling/    WSS signaling (Hono on Bun): pair/session routing only, no media
packages/
  protocol/     Strict wire-message schemas + envelope/sequence validation (runtime-neutral)
  crypto/       WebCrypto device identity, pairing proof, peer challenge (runtime-neutral)
  webrtc/       Peer connection factory + DataChannel helpers
  config/       Shared environment/config parsing
  testkit/      Shared test fakes
infra/coturn/   Reference TURN deployment
docs/           PRD, architecture, threat model, protocol, ADRs, issue files
tests/e2e/      Browser end-to-end tests
```

## Prerequisites

- **Node.js >= 22** (tests, typecheck, extension/PWA builds)
- **Bun >= 1.2** (workspace install, signaling runtime + signaling tests)

## Getting started

```sh
bun install
```

## Common commands

| Command | Purpose |
|---|---|
| `bun run lint` | Lint + format check (Biome) |
| `bun run format` | Write formatting |
| `bun run typecheck` | Strict TypeScript across all workspaces |
| `bun run test` | Unit/integration tests (Vitest) |
| `bun run test:signaling` | Signaling integration tests (Bun test) |
| `bun run test:security-scan` | Static forbidden-API/selector guardrail |
| `bun run build` | Build all workspaces |
| `bun run dev:signaling` | Run signaling locally |
| `bun run dev:extension` | WXT dev build of the extension |
| `bun run dev:mobile` | Vite dev server for the PWA |

## Implementation status

See [docs/GITHUB_MILESTONES.md](docs/GITHUB_MILESTONES.md) and [docs/github-issues/](docs/github-issues/). The build-out follows M0 → M1 → M2 → M3 in dependency order; each issue lands on its own branch and references the issue number in its commits.

## Hard boundaries (release blockers)

- No ChatGPT DOM/output scraping — the phone observes the target only through streamed pixels.
- Never export browser credentials (`chrome.cookies`, CDP cookie APIs, profile access).
- No generic CDP bridge from peer input — only narrowly typed adapters (ADR-004).
- Remote mode starts only from an explicit local user action (ADR-005).
- Fail closed on any auth/protocol/capture uncertainty.
