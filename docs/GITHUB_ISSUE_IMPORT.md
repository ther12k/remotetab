# GitHub Issue Registration Guide

The `github-issues/` folder contains issue bodies ready to register.

## Create milestones first

```text
M0 — Repository foundation
M1 — Local remote-control vertical slice
M2 — Secure pairing and sessions
M3 — WAN readiness and MVP gate
```

## Create labels

Use the label list in `GITHUB_MILESTONES.md`.

## Register in numeric order

Example:

```bash
gh issue create   --title "<first Markdown heading>"   --body-file "github-issues/001-bootstrap-monorepo.md"   --label "type:chore"   --label "priority:P0"   --milestone "M0 — Repository foundation"
```

After GitHub assigns real numbers, update dependency references if desired.

## Recommended implementation batches

```text
Batch 1: 001–005
Batch 2: 006–012
Batch 3: 013–016
Batch 4: 017–020
```

Do not ask an implementation agent to open twenty parallel PRs.

## PR rule

Each issue should map to one focused PR where practical.

PR description must include:

- what changed;
- security impact;
- test/evidence;
- known limitations;
- issue link.
