# Milestone 18: Test & Simulation Harness

Status: verified

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
| 0083 | verified | task/0083-fake-github | Fake GitHub (in-memory `GitHubPort`) | In-memory issues/PRs/labels/comments/checks the controller drives offline; `dump()` + injectable clock. |
| 0084 | verified | task/0084-fake-and-replay-backends | Fake & Replay Backends | Scripted `FakeBackend` + cassette `ReplayBackend` + capability presets + `runBackendConformance` — no quota. |
| 0085 | verified | task/0085-scenario-runner-and-goldens | Scenario Runner & Golden Assertions | Declarative scenarios → canonical digest-redacted golden (labels/PRs/comments/plan/run-records). |
| 0086 | verified | task/0086-simulation-and-fault-injection | Simulation & Fault Injection | `VirtualClock` + storms/races/drops/crashes + 5 invariants + seeded fuzz/shrink. |
| 0087 | verified | task/0087-tiered-ci-and-live-smoke | Tiered CI Wiring & Live Smoke | `LOOPER_TIER` selector + network/secret hermeticity guards + two CI workflows; live smoke operator-pending. |

## Definition Of Done

- Whole loops run end-to-end on fake GitHub + fake/replay backends, deterministically
  and offline, in per-PR CI — zero subscription quota spent.
- Golden scenarios assert end-state (labels/PRs/plan/run-records) and fail on drift.
- Simulation proves the core invariants (no double-dispatch / no stranded items /
  idempotent ingest) under storms, races, drops, and crashes.
- A gated live smoke catches provider API drift without gating every PR on it.

## Verification Log

- 2026-06-12: M18 complete (0083–0087 verified). The dev-only `@looper/testing`
  package now drives the UNMODIFIED runtime through all five tiers offline, zero
  quota: the `FakeGitHub` + `FakeBackend`/`ReplayBackend` (+ capability presets +
  `runBackendConformance`), the scenario runner with committed digest-redacted
  goldens, and a `VirtualClock`-driven simulation engine that asserts five
  invariants under storms/races/drops/crashes with a seeded fuzz/shrink mode.
  Tier selection (`LOOPER_TIER`) + the hermeticity guards (network guard +
  secret-absence, self-gated on `LOOPER_HERMETIC=1`) keep the live tier out of
  per-PR CI; `looper-ci.yml` runs tiers 1–4 and `looper-live-smoke.yml` gates the
  real-subscription smoke to manual/nightly. Repo-wide: 226 tests across 31 files
  green, lint + build clean. DoD met for tiers 1–4 + simulation; the live-smoke
  EXECUTION (real subscription) + cassette `--rerecord` are operator-pending (an
  offline agent cannot exercise a live subscription) — the harness logic is
  verified hermetically with stub backends.
