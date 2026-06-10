# Milestone 06: Project Adapter System

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "Generic-ness,
> in three plugin systems" (project adapters). Without this, "any GitHub project"
> is false.

## Objective

Ship the plugin interface that lets looper operate an arbitrary project —
`detect / build / test / lint / run / deploy` — with auto-detection for common
stacks, bundled adapters, and a generic command escape hatch so any repo works on
day one.

## Guiding Decisions

- The adapter interface is small and uniform; everything project-specific lives
  behind it.
- Auto-detect when possible; always allow explicit config to override.
- A generic "run these commands" adapter guarantees coverage for unrecognized
  stacks — no project is unsupported.
- Adapters are testable in isolation with a conformance test kit.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0024 | planned | task/0024-adapter-interface | Adapter Interface | The detect/build/test/lint/run/deploy contract. |
| 0025 | planned | task/0025-stack-autodetection | Stack Auto-Detection | Heuristics that pick an adapter from repo contents. |
| 0026 | planned | task/0026-generic-command-adapter | Generic Command Adapter | Config-driven escape hatch covering any project. |
| 0027 | planned | task/0027-bundled-adapters | Bundled Adapters | First-party adapters for common stacks (e.g. Node, Python). |
| 0028 | planned | task/0028-adapter-authoring-guide-and-testkit | Adapter Authoring Guide & Test Kit | Docs + conformance tests for third-party adapters. |

## Definition Of Done

- A documented adapter interface exists, exercised by ≥2 bundled adapters.
- Looper auto-detects common stacks and falls back to the generic command adapter
  otherwise.
- Any project can be configured to build/test/run without a bespoke adapter.
- Third parties can author and verify an adapter using the guide + test kit.

## Verification Log

Add dated entries as tasks land.
