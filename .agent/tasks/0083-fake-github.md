# 0083 Fake GitHub (in-memory `GitHubPort`)

Status: planned  
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

- [ ] A `GitHubPort` fake implements all methods over in-memory state, drop-in for
      the real client.
- [ ] Mutations emit (or suppress) events matching GitHub semantics, including the
      `GITHUB_TOKEN`-no-retrigger and bot-author rules.
- [ ] Ids/timestamps are deterministic (seeded); fixtures build common states.
- [ ] Author-association is settable per actor (for M17 tests).

## Implementation Checklist

- [ ] Implement the in-memory state + all `GitHubPort` methods.
- [ ] Implement the event queue with correct emit/suppress semantics.
- [ ] Seeded ids/timestamps + starting-state builders.
- [ ] (Optional) record mode to capture real responses as fixtures.

## Test Plan

```bash
# replace with the chosen stack's runner
# drive the runner against the fake; assert event emit/suppress parity vs. GitHub
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the state shape, the event emit/suppress rules modeled, and seeding.

## Risks / Rollback

If the fake's event semantics drift from real GitHub, scenario tests pass while
production breaks — the gated live smoke (0087) exists to catch exactly that drift.

## Final Summary

Fill this in before marking verified.
