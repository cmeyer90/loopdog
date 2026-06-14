# 0098 Plan-store fragmentation: one durable plan per issue

Status: implemented  
Branch: claude/optimistic-shamir-17b43f

## Goal

One issue produces exactly one durable plan, bound to the source issue, carrying
the groomed acceptance criteria and scope. End-to-end dogfood
(`cmeyer90/looper-auto-dogfood#2`) exposed three failure modes that this task
removes.

## Background

Driving one issue through triage→groom→implement→review surfaced three bugs in
the plan store (see memory `dogfood-looper-auto-dogfood` and PR
`cmeyer90/loopdog#8`):

1. **Duplicate stubs from racing triage runs** — `0001-*.md` and `0002-*.md` for
   one issue. `bindIssue` ([packages/plans/src/binding/binding.ts](../../packages/plans/src/binding/binding.ts))
   only short-circuits on the issue-body marker; with the marker write lost to a
   race (or a stale snapshot), the second run mints a fresh `nextTaskId()` plan.
2. **PR-bound plan with the wrong `Issue:`** — `0003-*.md` had `Issue: #4` (the
   PR number) instead of source issue `#2`. Any loop whose item is a
   **pull-request** (review, merge) calls `syncPlanAfterTransition`
   ([packages/runtime/src/pipeline/plan-sync.ts](../../packages/runtime/src/pipeline/plan-sync.ts))
   with the PR snapshot, so `openPlan`/`bindIssue` mint a plan bound to the PR.
3. **Criteria/scope never reached the durable plan** — the PR-bound `0003` kept
   the template placeholders (`(groomed criteria land here)`), so the review work
   cell read no criteria from the plan and improvised prose instead of a
   `loopdog-verdict:` line. Groom only ever wrote criteria into the issue body
   (loopdog's canonical source — `parseCriteriaBlock`), and scope is never
   propagated at all.

## Scope

- `bindIssue`: scan for an existing plan bound to the issue (`Issue:` header)
  before minting a new id — idempotent under concurrent triggers.
- `syncPlanAfterTransition`: when the item is a pull-request, resolve its source
  issue and run plan lifecycle against the issue's plan; never mint a PR-bound
  plan. Skip upkeep for a PR with no linked issue.
- Propagate groomed **scope** into the plan (criteria already propagate via
  `openPlan`); add `parseScopeBlock` to `@loopdog/core`.
- Tests for all three.

## Out Of Scope

- Full distributed mutual exclusion across GitHub writes (the claim mechanism is
  the intended serialization; scan-before-mint closes the realistic window).
- Reworking the issue↔PR link heuristic (reuse existing `linkedIssue`).

## Acceptance Criteria

- [x] Two triage runs on the same issue produce exactly one plan file. (test: packages/plans/test/binding-lifecycle.test.ts)
- [x] A review/merge transition on a PR updates the source issue's plan; its `Issue:` field stays the source issue, and no PR-numbered plan is created. (test: packages/runtime/test/plan-sync.test.ts)
- [x] Groomed acceptance criteria AND scope land in the durable plan, not just the issue body. (test: packages/plans/test/binding-lifecycle.test.ts)
- [x] `#2` does not false-match `#20` in the Issue-field scan. (test: packages/plans/test/binding-lifecycle.test.ts)
- [x] `npm run build`, `npm test`, `npm run lint` pass.

## Implementation Checklist

- [x] `parseScopeBlock` in `packages/core/src/gates/criteria.ts` + core index export.
- [x] `bindIssue` scans `Issue:` field before minting; share scan with `resolveBinding`; tighten `#N` match.
- [x] `openPlan` + `writeTaskFile` propagate scope.
- [x] `plan-sync.ts` resolves PR → source issue (`linkedIssue`); skip when unlinked.
- [x] Tests; run build/test/lint.

## Test Plan

```bash
npm run build
npm test
npm run lint
```

## Verification Log

- 2026-06-13: Task opened; root-caused all three symptoms against the dogfood notes.
- 2026-06-13: Implemented all three fixes + tests.
  - `npm run build` — clean (`tsc -b`).
  - `npm test` — 260 passed (37 files). New: 3 in
    `packages/plans/test/binding-lifecycle.test.ts`, 2 in
    `packages/runtime/test/plan-sync.test.ts`.
  - `npm run lint` — eslint + boundaries + prettier all clean.
  - Two golden hashes (`implement-happy-path`, `example-node-todo`) updated:
    the bound plan's Scope section now carries the groomed scope instead of the
    placeholder (verified the rendered plan is well-formed before updating).

## Decisions

- Fix the PR→issue resolution in `syncPlanAfterTransition` (the single funnel for
  all three call sites) rather than per-loop — it covers review and merge at once.
- Idempotency via `Issue:`-field scan-before-mint: when two runs race, either
  both compute the same `nextTaskId()`+slug (same path, identical content → the
  store's render-then-compare collapses them) or the later run sees the first's
  file and reuses it. No new lock primitive.

## Risks / Rollback

- A PR that references the wrong `#N` first in its body would bind to the wrong
  issue — but that is the same heuristic the merge-mirror already trusts.
- `bindIssue`'s marker write still replaces the issue body from the caller's
  snapshot (pre-existing behaviour). Under a true sub-second race two runs can
  each write, but both write the SAME marker (same reused task id), so the
  outcome is one marker + one plan. Tightening this to re-read the live body
  before appending is a separate, optional hardening.
- Revert is a single-commit `git revert`; the plan format is unchanged.

## Final Summary

One issue now yields exactly one durable plan, bound to the source issue, with
groomed criteria + scope carried in. Three changes: (1) `bindIssue` reuses an
existing `Issue:`-bound plan before minting a new id (idempotent under racing
triage; `#N` matched exactly so `#2`≠`#20`); (2) `syncPlanAfterTransition`
resolves a pull-request item back to its linked source issue, so review/merge
loops update the issue's plan instead of minting a PR-numbered one (and skip
upkeep entirely for an unlinked PR); (3) groomed scope now propagates into the
plan (`parseScopeBlock` + `openPlan`/`writeTaskFile`), joining the criteria that
already did. All checks green.
