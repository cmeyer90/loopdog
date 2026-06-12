# 0094 Core Port Interfaces & Run-Record Store

Status: verified  
Branch: claude/laughing-johnson-8a7944

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

- [x] All five port interfaces exist as real TS in `@looper/core`, importable by
      consumers; `GitHubPort`'s method surface is fully enumerated (six composed
      capability interfaces: Issues/Labels/Pulls/Checks/RepoFiles/Identity);
      `RepoFs` is declared in `ports/project-adapter.ts`.
- [x] The run-record store is owned by 0053 (orphan `looper/telemetry` branch);
      core only defines the type + `runRecordPath()`; the store impl lives in
      `@looper/runtime` telemetry (`TelemetryBranchStore`).
- [x] The run-record type is defined and matches 0012's schema.
- [x] `@looper/core` stays IO-free (interfaces + pure functions; zero deps).

## Implementation Checklist

- [x] Write the five interfaces + the `RepoFs` type + the run-record type in
      `@looper/core` (`src/ports/`, `src/run-record/`).
- [x] Enumerate `GitHubPort` methods + the normalized `TriggerEvent` type.
- [x] Defer the run-record store to 0053 (orphan `looper/telemetry` branch).
- [x] Confirm consumers compile against the interfaces (claims 0013, runner
      0012, fake GitHub 0083, Octokit adapter, fake backend 0084 all do).

## Test Plan

```bash
# type-check only: consumers compile against the interfaces; core has no IO deps
```

## Verification Log

- 2026-06-09: `npm run build` green with both implementations of `GitHubPort`
  (OctokitGitHub + FakeGitHub) and one of `ExecutionBackend` (FakeBackend)
  compiling against the ports — the interfaces are consumer-proven.
- 2026-06-09: boundary check confirms `@looper/core` imports nothing.

## Decisions

- `GitHubPort` = composition of six capability interfaces (IssuesPort,
  LabelsPort, PullsPort, ChecksPort, RepoFilesPort, IdentityPort) so fakes and
  partial consumers implement exactly what they use. Notable surface choices:
  `listPullRequestsByHeadPrefix` (correlation 0073), `removeLabel` is
  idempotent by contract, `writeFile` takes `expectedSha` (optimistic
  concurrency for plan/telemetry writes), `ensureBranch` supports `orphan`.
- `RepoFs` = `{readFile, exists, list}` read-only view for adapter `detect()`.
- Run-record type per 0012's schema (`RunRecord` with steps/outcome/cost +
  `FailureClass` from M19's taxonomy); ids via `deriveRunId` (FNV-1a, no
  crypto dep) and `idempotencyKey` = `loop:owner/repo#n:from`.
- `SecretBackend` = `{residency, available, resolve}` + the pure `scrubSecrets`
  leak guard (0031) exported beside it.
- Store deferred to 0053 as specced; `TelemetryBranchStore` (runtime) writes
  day-bucketed NDJSON to `looper/telemetry` via `RepoFilesPort` with CAS retry.

## Risks / Rollback

Getting `GitHubPort` wrong ripples to every consumer — pin it before 0012/0013/0073
start. Sequence 0083 (the GitHub fake) immediately after this so the IO-shaped
claim/runner logic is testable.

## Final Summary

All five ports live in `@looper/core/src/ports/` as real, consumer-proven TS:
`GitHubPort` (six composed capability interfaces, fully enumerated),
`ExecutionBackend` (`capabilities/dispatch/ingest` with the 0093 dual-signal
correlation types), `ProjectAdapter` (+`RepoFs`), `PlanStore` (typed plan
shapes + statuses), `SecretBackend` (+`scrubSecrets`). Run-record type +
id/key/path helpers in `src/run-record/`. Core remains dependency-free; two
GitHubPort impls and one backend impl compile against the contracts.
