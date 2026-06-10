# Milestone 18: Test & Simulation Harness

Status: planned

> Background: [Codebase Layout](../../docs/codebase.md) "Testing strategy." Closes
> a production gap: how do you e2e-test an autonomous dispatcher **without burning
> subscription quota or hitting real GitHub**? The modular design makes this cheap
> — IO is behind ports (interfaces in `@looper/core`), so fakes are drop-ins.

## Objective

A deterministic, offline test harness that exercises whole loops end-to-end
against a **fake GitHub** and **fake/replay backends** — plus a simulation layer
for storms/races/crashes — so looper's behavior and invariants are provable in CI
with zero quota spent and no network.

## Guiding Decisions

- **Ports make fakes free.** Because `GitHubPort`, `Backend`, `ProjectAdapter`, and
  `PlanStore` are interfaces in `@looper/core`, the harness injects in-memory fakes
  and runs the *real* controller unchanged.
- **No real quota in per-PR CI.** Provider calls are scripted fakes or **recorded
  cassettes** (record-once/replay); a tiny live smoke against a real subscription
  runs only behind a manual/nightly gate (to catch provider drift, e.g. the beta
  routine API).
- **Golden scenarios over assertions-by-hand.** A scenario = initial repo state +
  a sequence of events/sweeps → assert the resulting labels/PRs/plan/run-records
  against a golden snapshot.
- **Simulate the hard cases**: a deterministic clock + fault injection for event
  storms, event↔sweep races, dropped webhooks, and mid-run crashes — asserting the
  invariants (no double-dispatch, no stranded items, idempotent ingest).
- The harness lives in a **dev-only `@looper/testing` package** (fakes + scenario
  + simulation runner + fixtures); it is not shipped.

Test tiers:

```
1 unit        @looper/core pure logic — no fakes needed (IO-free)
2 component   each port impl vs. a fake/recorded counterpart (backend/adapter conformance)
3 scenario    whole loops on fake-GitHub + fake/replay backend → golden end-state
4 simulation  deterministic clock + fault injection → invariants hold
5 live-smoke  real scratch repo + real subscription, MANUAL/NIGHTLY gate only
```

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0083 | planned | task/0083-fake-github | Fake GitHub (in-memory `GitHubPort`) | In-memory issues/PRs/labels/comments/checks/events the controller drives offline. |
| 0084 | planned | task/0084-fake-and-replay-backends | Fake & Replay Backends | Scripted fake backend + record/replay cassettes for Claude/Codex — no quota. |
| 0085 | planned | task/0085-scenario-runner-and-goldens | Scenario Runner & Golden Assertions | Declarative scenarios → golden labels/PRs/plan/run-records. |
| 0086 | planned | task/0086-simulation-and-fault-injection | Simulation & Fault Injection | Deterministic clock + storms/races/drops/crashes → invariant checks. |
| 0087 | planned | task/0087-tiered-ci-and-live-smoke | Tiered CI Wiring & Live Smoke | The pyramid in CI; provider-drift live smoke behind a manual/nightly gate. |

## Definition Of Done

- Whole loops run end-to-end on fake GitHub + fake/replay backends, deterministically
  and offline, in per-PR CI — zero subscription quota spent.
- Golden scenarios assert end-state (labels/PRs/plan/run-records) and fail on drift.
- Simulation proves the core invariants (no double-dispatch / no stranded items /
  idempotent ingest) under storms, races, drops, and crashes.
- A gated live smoke catches provider API drift without gating every PR on it.

## Verification Log

Add dated entries as tasks land.
