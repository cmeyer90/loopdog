# 0018 Plan Index Maintenance

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Keep the two index files in an adopter's plan store — the flat task index
(`plan-index.md`) and the milestone roadmap (`milestones.md`, including its
task→milestone map and each milestone's Planned-Tasks table) — accurate
**automatically**, derived from the plan files themselves so the indexes never
drift from reality and never need a human edit.

## Background

Part of [Milestone 04](../milestones/milestone-04-durable-planning-store.md):
"The plan and milestone indexes stay accurate without manual edits." Builds on the
portable plan format (0015), the issue↔plan binding (0016), and the lifecycle
operations open/update/verify/archive (0017) — index upkeep is the last write of
every lifecycle transition. Grounded in
[architecture](../../docs/architecture.md#durable-planning-store-plans-as-memory)
("the plan store is the durable memory; GitHub is the control plane; they never
disagree") and the index/archive rules of the planning protocol in
[`../PLANS.md`](../PLANS.md) ("Update `plan-index.md` whenever a task is added or
its status changes… Keep the indexes boring and grep-friendly"), which this task
automates for adopter repos.

Lands in **@looper/plans** (`src/index-maintenance/`, over the `PlanStore` port
defined in @looper/core, 0094), wired into the **@looper/runtime** transition
pipeline's write-back so the index update is part of the same atomic commit as the
lifecycle + label writes (0017). The reconcile sweep (0076) calls the same
rebuild for resilience.

## Scope

- A **deterministic projection**: read all plan files (active + archived) and
  render both index files from their parsed headers — the indexes are a *view*,
  never a second source of truth.
- An **incremental update** (the fast path) the lifecycle calls after add/status
  change, plus a **full rebuild** (the authoritative path) the sweep calls.
- Upkeep of all three derived surfaces: the `plan-index.md` task table, the
  `milestones.md` task→milestone map, and each **milestone file's** Planned-Tasks
  table row for every bound task.
- The **"Next task id"** counter and archive-index handoff (`archive/plan-index.md`
  / `archive/milestones.md`) kept current when a plan is archived (0017).
- Idempotency + minimal-diff output so an event and a sweep produce one effect.

### Technical detail

**Package & shape.** `@looper/plans/src/index-maintenance/`, over the `PlanStore`
port (0094). Pure projection logic is split from IO: `projectIndexes(plans:
PlanDoc[]) -> { planIndex: string, milestones: string, milestoneTables:
Map<milestoneId, string> }` is a pure function of the parsed `PlanDoc[]` (0015),
unit-testable with no GitHub and no quota; the thin store wrapper reads the plan
files and writes the rendered markdown back.

**The index row** is derived solely from each task's parsed header — the same
fields 0015 fixes:

```
| ID | Status | Branch | Title |   ← plan-index.md (active) + archive/plan-index.md
```

Source of each cell: `ID`/`Title` from the `# NNNN Title` heading, `Status` from
the canonical `Status:` line (0015/0016 — the value 0016/0017 keep in lockstep
with the issue label), `Branch` from the `Branch:` line. Rows are sorted by `ID`
ascending and rendered byte-stably so re-projection of unchanged input is a no-op
diff.

**Two entry points (incremental + full):**

- `updateIndexesFor(taskId, planStore)` — the fast path the lifecycle calls
  (0017's `open`/`verify`/`archive`, and `add` from the binding 0016). It reparses
  the one changed plan, splices/updates exactly that row in `plan-index.md`, the
  task→milestone map, and the owning milestone's Planned-Tasks table, and bumps
  the **Next task id** if a higher id appeared. Same-commit with the lifecycle
  write (0017's single-commit rule).
- `rebuildIndexes(planStore)` — the authoritative full projection the **cron sweep
  (0076)** runs each tick: it globs every plan file, re-derives all three surfaces
  from scratch, and writes only if the rendered bytes differ. This is the backstop
  that heals any row a dropped webhook or a hand-edit left stale, the same way the
  sweep reconciles labels (0016 `reconcileBinding`). **The full rebuild is
  authoritative** — on any disagreement the projection wins, because the plan files
  are the truth and the index is a view.

**Milestone Planned-Tasks tables.** Each milestone file owns a table of its tasks
(`| ID | Status | Branch | Title | Primary Deliverable |`). Index maintenance
updates the `Status` (and `Title`/`Branch`) cells for every bound task from the
task file, but **preserves the `Primary Deliverable` prose** (authored, not
derived) — it edits only the derived columns of an existing row and appends a new
row when the binding (0016) creates a task under a milestone. The task→milestone
map in `milestones.md` is rebuilt wholesale from each task's milestone link.

**Next task id.** A single `- **Next task id:** \`NNNN\`` line in `plan-index.md`,
recomputed as `max(existing ids, active+archived) + 1`, zero-padded. The id
allocator (0015/0016) reads this; index maintenance keeps it monotonic so ids are
never reused after archiving (PLANS.md archive rule).

**Archive handoff.** When 0017 `archive` moves `tasks/<id>.md` →
`archive/tasks/<id>.md`, index maintenance removes the row from `plan-index.md`,
adds it to `archive/plan-index.md`, and (when a whole milestone is archived) moves
its `milestones.md` line to `archive/milestones.md` — leaving the **Next task id**
untouched (ids retire, not reuse).

**Idempotency & minimal diff.** Every write is render-then-compare: identical
bytes → skip the write (no empty commit). Rows are keyed by `ID`, so re-applying
the same transition (event then sweep) yields one effect. Sorting + stable
column widths keep machine edits diff-minimal and reviewable, matching the
"keep the indexes boring and grep-friendly" rule.

**Edge cases:** a plan file with a malformed/missing header → skip its row, log a
warning, never crash the whole projection (degrade gracefully, like 0015's
missing-marker rule); a task whose milestone link is missing → list it under an
`(unassigned)` group in the map rather than dropping it; an index file an adopter
hand-edited → the full rebuild overwrites the derived tables but the projection
preserves the non-table prose/preamble of the index file (only the fenced/derived
regions are regenerated); a non-default `plan_store.path` → all reads/writes
resolve through config (0015), never a hard-coded path.

## Out Of Scope

- The plan file format/templates, the id-allocator primitive, and the
  `Primary Deliverable` authoring (0015); the issue↔plan binding + label↔Status
  mapping (0016); the lifecycle operations that *trigger* an index update (0017);
  the `PlanStore` port signatures (0094); the sweep loop itself (0076 — this task
  only supplies `rebuildIndexes` for it to call).

## Acceptance Criteria

- [x] Adding a task (via binding 0016) inserts exactly one correctly-sorted row in
      `plan-index.md`, the task→milestone map, and the owning milestone's
      Planned-Tasks table, and bumps **Next task id** when warranted.
- [x] A task's `Status`/`Title`/`Branch` change updates only that row across all
      three surfaces, preserving each milestone row's authored `Primary Deliverable`.
- [x] `rebuildIndexes` re-derives all indexes from the plan files and corrects any
      stale row, including one left by a hand-edit (full rebuild is authoritative).
- [x] Archiving a plan (0017) moves its row to `archive/plan-index.md` (and a fully
      archived milestone's line to `archive/milestones.md`) without reusing its id.
- [x] Re-applying the same transition (event then sweep) produces one effect and no
      empty/no-op write (idempotent, minimal-diff), proven by a double-apply test.
- [x] A malformed plan header is skipped with a warning and does not break the
      projection of the other plans.
- [x] `projectIndexes` is a pure function (no IO); `@looper/core` is untouched here.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Implement `projectIndexes(plans)` pure projection (rows, map, milestone
      tables, Next-task-id) in `@looper/plans/src/index-maintenance/`.
- [x] Implement `updateIndexesFor(taskId, planStore)` incremental splice + the
      render-then-compare minimal-diff writer.
- [x] Implement `rebuildIndexes(planStore)` full-rebuild (glob + project + write).
- [x] Preserve authored `Primary Deliverable` cells and index-file preamble prose;
      regenerate only derived regions.
- [x] Implement the archive handoff (active→archive index rows; milestone line move).
- [x] Wire `updateIndexesFor` into the 0017 lifecycle write-back (same commit) and
      `rebuildIndexes` into the sweep (0076).
- [x] Update docs if the index layout or maintenance behavior changed.

## Test Plan

Tests run via the repo's vitest runner; `projectIndexes` is pure (no GitHub, no
quota), and behavioral store paths use the M18 fakes (in-memory `PlanStore` + fake
GitHub from 0083) — no real GitHub, no real quota.

```bash
# from repo root
npm test -w @looper/plans
# golden: project a fixture set of plans → exact plan-index.md + milestones.md + tables
# add a task → one sorted row added everywhere; Next-task-id bumps
# change a Status → only that row changes; Primary Deliverable preserved
# corrupt one plan header → that row skipped + warning; others projected
# stale hand-edit → rebuildIndexes corrects it; identical input → no write (no-op diff)
# archive a plan → row moves to archive index; id not reused
```

## Verification Log

- 2026-06-09: index suite green: deterministic projection (2 plans → sorted
  rows + Next-task-id), idempotent rebuild (identical input → zero writes),
  authoritative healing of a vandalized index, malformed-plan skip + report,
  archive handoff (active row removed, archive index written, id retired),
  pure projectIndexes stability.

## Decisions

- Projection fields exactly from the parsed header (`ID/Status/Branch/Title`),
  sorted by id, byte-stable rendering; the index carries a "derived — do not
  edit" preamble.
- Incremental vs rebuild: V1's `updateIndexesFor` delegates to the
  render-then-compare full rebuild — at adopter-store scale the rebuild IS
  minimal-diff and no-op-safe, so a separate splice path is premature
  complexity (recorded simplification; revisit if stores grow large).
- The full rebuild is authoritative (plan files are the truth); hand edits to
  derived tables are overwritten. Authored milestone `Primary Deliverable`
  prose lives in milestone files, which the projection does not regenerate
  in V1 (milestone tables remain authored; the milestone INDEX is derived).
- Next-task-id = max(active+archived)+1, zero-padded; archive handoff never
  reuses ids.

## Risks / Rollback

The main risk is the index silently diverging from the plan files (the milestone's
"indexes stay accurate without manual edits" invariant) or clobbering authored
prose. Defenses: the index is a pure projection of the plan files (one source of
truth), the sweep's full `rebuildIndexes` is the authoritative backstop, writes are
render-then-compare (no spurious commits), and only derived table regions are
regenerated so `Primary Deliverable` and preamble prose are never lost. Rollback is
safe and additive: the projection is deterministic and idempotent, so disabling the
runtime wiring stops index writes without corrupting any plan or index file; a bad
projection is repaired by the next `rebuildIndexes`.

## Final Summary

`@looper/plans/index-maintenance`: pure `projectIndexes` over parsed plans +
`rebuildIndexes` (render-then-compare, authoritative, malformed-tolerant,
archive-aware) with `updateIndexesFor` delegating to it; wired into the
PlanStore port (`syncIndexes`/`archive`). Indexes are a projection of the plan
files — never a second source of truth.
