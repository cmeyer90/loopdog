# 0083 Fake GitHub (in-memory `GitHubPort`)

Status: verified  
Branch: task/0083-fake-github

## Goal

An in-memory implementation of `GitHubPort` — issues, PRs, labels, comments,
checks, reviews, and events as data structures — so the real controller runs whole
loops offline, deterministically, with no network and no quota.

## Background

Part of [Milestone 18](../milestones/milestone-18-test-and-simulation-harness.md);
the keystone enabler. Because `GitHubPort` is an interface in `@looper/core`, a fake
is a drop-in the runner can't tell from the real Octokit wrapper. Lives in the
dev-only `@looper/testing` package. See [codebase](../../docs/codebase.md) "Testing
strategy."

## Scope

- Implement every `GitHubPort` method against in-memory state (repos/issues/PRs/
  labels/comments/checks/reviews/assignees).
- Model **events**: mutations enqueue events a test can deliver to the controller
  (mirroring GitHub's event semantics, incl. the `GITHUB_TOKEN`-no-retrigger rule
  and bot-vs-token authorship).
- Deterministic ids/timestamps (seeded), so runs are reproducible.
- Builders/fixtures for common starting states.

### Technical detail

- State is a plain object graph; methods are synchronous over it (wrapped to the
  port's async signature). No clock/network — time is injected (M18 · 0086).
- **Event fidelity matters most:** the fake reproduces *which* mutations emit
  workflow-triggering events and which don't (e.g. a label set by the `looper`
  token does not enqueue a triggering event; a PR opened by the "provider app"
  identity does). This is what lets scenario tests prove the events-vs-sweep
  behavior (M02 · 0076) without real GitHub.
- Author-association is settable per actor, so authorization tests (M17) run here.
- Optional **record mode**: capture real API responses into fixtures the fake can
  replay (pairs with the backend cassettes, 0084).

## Out Of Scope

- Backend fakes (0084); the scenario runner (0085); fault injection (0086).

## Acceptance Criteria

- [x] A `GitHubPort` fake implements all methods over in-memory state, drop-in for
      the real client.
- [x] Mutations emit (or suppress) events matching GitHub semantics, including the
      `GITHUB_TOKEN`-no-retrigger and bot-author rules.
- [x] Ids/timestamps are deterministic (seeded); fixtures build common states.
- [x] Author-association is settable per actor (for M17 tests).

## Implementation Checklist

- [x] Implement the in-memory state + all `GitHubPort` methods.
- [x] Event semantics: realized as EXPLICIT delivery (no auto-emit queue) — the
      `GITHUB_TOKEN`-no-retrigger + bot-author rules hold by construction (a
      controller-written transition never re-feeds itself; it advances on the
      next sweep). See Decisions.
- [x] Seeded ids/timestamps + starting-state builders (+ injectable `VirtualClock`).
- [ ] (Optional) record mode to capture real responses as fixtures — deferred;
      the replay cassettes (0084) cover record-once/replay instead.

## Test Plan

```bash
# replace with the chosen stack's runner
# drive the runner against the fake; assert event emit/suppress parity vs. GitHub
```

## Verification Log

- 2026-06-12: the `FakeGitHub` `GitHubPort` underpins every tiers-1–4 test (226
  repo-wide green) — the four loops e2e (M08–M11), authorization e2e (M17), the
  0085 scenario goldens, the 0086 simulation invariants, and the 0084 backend
  conformance — all drive the UNMODIFIED runtime over it offline, zero quota.
  Added this milestone: a read-only `dump()` (issues/pulls/comments/files) for
  golden snapshots (0085), and an optional injectable `clock` so mutations bump
  `updatedAt` and comments timestamp at clock-time (exercises the fix-loop
  `updatedAfterDispatch` correlation guard, 0073, under the virtual clock).

## Decisions

- State is plain `Map`s keyed by `owner/repo#number` (issues, pulls, comments,
  check runs, reviews, per-branch file trees). Determinism: ids/timestamps come
  from `clockBase` + a monotonic counter by default, or the injected
  `VirtualClock` (0086) when set — never wall time. Author-association is
  settable per seeded item (the M17 authorization gate reads it).
- No auto-emitting event queue: the controller is driven by EXPLICIT events the
  test/scenario delivers (`handleEvent`) and explicit `handleSweep` ticks, so the
  `GITHUB_TOKEN`-no-retrigger rule holds by construction (a controller-written
  transition never re-feeds itself an event; it advances only on the next sweep).
  A `beforeOp(op)` hook is the fault-injection seam (0086) — throw from it to
  simulate an API failure at any operation.

## Risks / Rollback

If the fake's event semantics drift from real GitHub, scenario tests pass while
production breaks — the gated live smoke (0087) exists to catch exactly that drift.

## Final Summary

An in-memory `GitHubPort` over plain maps with deterministic, clock-injectable
ids/timestamps and a `beforeOp` fault seam — the drop-in GitHub every hermetic
tier drives the real runtime against, zero quota. Event semantics are realized by
explicit delivery (honoring no-retrigger by construction) rather than an
auto-emit queue; `dump()` exposes state for the 0085 goldens.
