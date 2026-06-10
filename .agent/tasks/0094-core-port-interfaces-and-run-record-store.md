# 0094 Core Port Interfaces & Run-Record Store

Status: planned  
Branch: task/0094-core-port-interfaces-and-run-record-store

## Goal

Land the actual `@looper/core` **port interfaces** (the contracts every package
codes against) as real TypeScript, and decide **where run records persist** — the
missing keystone between "scaffold stubs" (0001) and "implement behavior" (0011+).

## Background

Part of [Milestone 03](../milestones/milestone-03-github-state-machine-core.md);
build-order step 1 ([codebase](../../docs/codebase.md)). The plan review found the
five ports are *named everywhere but defined nowhere as signatures* — a day-one
blocker. 0001 lands stubs; the consumer tasks (0011/0013/0019/0073) assume the types
already exist. This task fills that crack. (The run-record **store** is owned by
0053 — the orphan `looper/telemetry` branch — and this task defers to it.)

## Scope

- Define the five port interfaces in `@looper/core` as concrete TS, even if methods
  initially `throw not-implemented`:
  - **`GitHubPort`** — enumerate the full method surface: issues/PRs/comments/labels/
    assignees/checks/reviews read+write, plus event types. (0013 claiming and 0073
    correlation both depend on this concretely; 0083's fake implements it.)
  - **`Backend`** — `capabilities() / dispatch() / ingest()` (from 0019).
  - **`PlanStore`**, **`ProjectAdapter`**, **`SecretBackend`** — method signatures
    + return types (not word-lists).
  - Declare the **`RepoFs`** type (the read-only repo view injected into
    `ProjectAdapter.detect()`) among the `@looper/core` port types.
- The **run-record store** is owned by
  [0053](0053-per-provider-outcome-telemetry.md): run records
  persist to a dedicated orphan git branch `looper/telemetry` as append-only
  day-bucketed NDJSON (`runs/YYYY-MM-DD.ndjson`), written via the contents API. This
  task **defers** to 0053 for the store; it does not define its own.
- Define the run-record TS type (from 0012's schema).

## Out Of Scope

- Implementing the ports (their own tasks); the plan-store format details (M04).

## Acceptance Criteria

- [ ] All five port interfaces exist as real TS in `@looper/core`, importable by
      consumers; `GitHubPort`'s method surface is fully enumerated; `RepoFs` is
      declared.
- [ ] The run-record store is owned by 0053 (orphan `looper/telemetry` branch); this
      task defers to it and references it rather than defining a store.
- [ ] The run-record type is defined and matches 0012's schema.
- [ ] `@looper/core` stays IO-free (interfaces only; no Octokit import).

## Implementation Checklist

- [ ] Write the five interfaces + the `RepoFs` type + the run-record type in
      `@looper/core`.
- [ ] Enumerate `GitHubPort` methods + event types.
- [ ] Defer the run-record store to 0053 (orphan `looper/telemetry` branch).
- [ ] Confirm consumers (0011/0013/0019) compile against the interfaces.

## Test Plan

```bash
# type-check only: consumers compile against the interfaces; core has no IO deps
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the `GitHubPort` method surface, the `RepoFs` type, and the run-record type.
The run-record store is owned by 0053 (orphan `looper/telemetry` branch); this task
defers to it.

## Risks / Rollback

Getting `GitHubPort` wrong ripples to every consumer — pin it before 0012/0013/0073
start. Sequence 0083 (the GitHub fake) immediately after this so the IO-shaped
claim/runner logic is testable.

## Final Summary

Fill this in before marking verified.
