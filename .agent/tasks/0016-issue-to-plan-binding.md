# 0016 Issue ↔ Plan Binding

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Bind every GitHub issue/epic to a durable plan in the target repo and keep the two
in lockstep: a generator that creates the linked plan file(s) for an item, a
discoverable two-way link between issue and plan, and a mirror that keeps the
issue's `looper:state/*` label and the plan `Status` from ever disagreeing.

## Background

Part of [Milestone 04](../milestones/milestone-04-durable-planning-store.md) —
"bind every issue/epic to a plan, and keep the issue label and plan `Status` in
sync." Grounded in [architecture](../../docs/architecture.md#durable-planning-store-plans-as-memory):
*the plan store is the durable memory; GitHub is the control plane; they never
disagree.* Builds on the portable plan format + store layout (0015) and the
`PlanStore` port + plan-store path decided in 0094. The binding is consumed by the
lifecycle automation (0017) which drives `Status` transitions, the index
maintenance (0018) which lists bound plans, and the DoR/DoD gate (0014) whose
acceptance-criteria block lives in the bound task file. Lands in `@looper/plans`
(generator + binding + mirror) with the `PlanStore` interface in `@looper/core`;
the effectful sync step is called from the `@looper/runtime` transition pipeline.

## Scope

- A **generator** that, for a given issue/epic, emits the linked plan: a task file
  (subtasks if the issue decomposes) and, for an epic, a milestone — using the
  0015 templates, written through `PlanStore` into the configurable store path.
- A **two-way link** so either side resolves the other deterministically, with no
  side store (GitHub + the plan files are the only truth).
- A **label ↔ Status mirror**: a pure mapping between `looper:state/*` labels and
  plan `Status` values, plus a reconcile step that detects and repairs drift.
- An **idempotent bind** — re-binding an already-bound issue updates, never
  duplicates.

### Technical detail

**Generator.** `bindIssue(issue, planStore, cfg) -> Binding`. If the issue is
unbound, it allocates the next task id (the plan store's id allocator from 0015 —
zero-padded `NNNN`, gap-free, collision-checked against existing files), renders
the task template with `Goal`/`Background` seeded from the issue title/body and the
`<!-- looper:acceptance-criteria -->` block (0014) carried verbatim, sets
`Status: planned`, and writes `<store>/tasks/NNNN-<slug>.md`. An **epic** (issue
labeled `looper:epic` or referencing children) also gets a milestone via the
milestone template and links its tasks under that milestone's Planned-Tasks table
(0018 owns ongoing upkeep). The commit carrying the new plan is authored by the
controller as `GITHUB_TOKEN`.

**Two-way link (defense in depth, mirroring the PR-correlation pattern of 0073).**

1. **Issue → plan:** a fenced marker appended to the issue body, parseable from
   GitHub state alone:
   ```
   <!-- looper:plan task=0016 milestone=04 path=.agent/tasks/0016-issue-to-plan-binding.md -->
   ```
2. **Plan → issue:** a `Issue:` field (and `Repo:` when cross-repo) written into
   the task file header next to `Status`/`Branch`, e.g. `Issue: #142`.
3. **Slug convention:** task slug derives from the issue (`<issue#>-<slug>` when
   configured) so a missing marker is still recoverable by scan.

`resolveBinding(issue)` reads (1), falls back to (3); `resolvePlan(taskFile)` reads
(2). A `Binding = { issue, repo, taskId, milestoneId?, path }`. No DB, no queue.

**Label ↔ Status mirror.** A single pure table in `@looper/core` (next to the state
machine, 0011) is the only place the mapping lives:

```
looper:state/new,needs-grooming,needs-clarification  -> planned
looper:state/ready-for-agent                         -> ready
looper:state/in-progress                             -> in-progress
looper:state/in-review,changes-requested             -> implemented
looper:state/verified                                -> verified
looper:state/merged                                  -> merged
looper:state/deployed                                -> merged   (deploy ≠ a plan status)
looper:state/deploying,looper:state/deploy-failed,looper:state/rolled-back -> merged
looper:blocked,looper:needs-human,looper:stuck       -> blocked
looper:quarantine                                    -> blocked
looper:abandoned                                     -> abandoned
```

`statusForLabel(label)` and `labelsForStatus(status)` are total over lifecycle
state labels plus terminal off-ramp labels and the 0094 `Status` enum
(planned/ready/in-progress/blocked/implemented/verified/merged/abandoned).
Operational hold labels such as `looper:needs-approval`, `looper:approved`,
`looper:parked`, `looper:stop`, and claim/pause markers are orthogonal: they do
not replace the lifecycle label and therefore do not rewrite plan `Status`.
`reconcileBinding(issue, plan)` compares the live lifecycle/off-ramp label to the
plan `Status`; on drift it treats **the GitHub label as authoritative** (GitHub is
the control plane) and rewrites the plan `Status`, recording the change in the
plan's Verification Log. This is the primitive 0017 calls on every lifecycle
transition and the cron sweep (0076) calls to repair items a dropped webhook left
stale.

**Idempotency.** `bindIssue` short-circuits when a valid marker + plan file already
exist; `reconcileBinding` is a no-op when label and `Status` already agree (guard
on equality). Both safe under event and sweep invocation, per the M03 idempotency
contract (0012).

**Edge cases:** marker present but plan file deleted → re-generate, warn; two
issues claiming the same task id → fail closed, route to `needs-human`; manual edit
of plan `Status` that disagrees with the label → label wins, plan rewritten + note
logged; epic with no children yet → milestone created, empty task table.

## Out Of Scope

- The plan file format/templates and id allocator (0015); the `PlanStore` port
  signature + store path (0094); driving the `Status` transitions themselves
  (0017); index/milestone-table upkeep (0018); generating acceptance criteria
  (M08 grooming).

## Acceptance Criteria

- [x] Binding an unbound issue creates the linked task (and a milestone for an
      epic) from the 0015 templates in the configured store path, with `Status:
      planned` and the acceptance-criteria block carried over.
- [x] The issue carries a `<!-- looper:plan … -->` marker and the task file carries
      an `Issue:` field; each side resolves the other deterministically.
- [x] `statusForLabel` / `labelsForStatus` are total over lifecycle + terminal
      labels and the 0094 `Status` enum, with the documented mapping; operational
      hold labels do not rewrite plan `Status`.
- [x] `reconcileBinding` repairs drift by making the plan `Status` match the live
      label (label authoritative) and logs the change; it is a no-op when they
      already agree.
- [x] Re-binding an already-bound issue updates in place and never duplicates a
      plan file or marker (idempotent under event + sweep invocation).
- [x] `@looper/core` stays IO-free (mapping + types only; writes go through
      `PlanStore`/`GitHubPort`).

## Implementation Checklist

- [x] Add the label↔Status mapping table + `statusForLabel`/`labelsForStatus` in
      `@looper/core`.
- [x] Implement `bindIssue` (id alloc via 0015, template render, marker + `Issue:`
      field, epic→milestone) in `@looper/plans`.
- [x] Implement `resolveBinding`/`resolvePlan` (marker → slug fallback → `Issue:`).
- [x] Implement `reconcileBinding` (drift detect, label-wins rewrite, Verification
      Log note, no-op guard).
- [x] Wire the bind + reconcile step into the `@looper/runtime` pipeline so a
      transition keeps label and `Status` in sync.
- [x] Update docs if the marker format or store-path config changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(in-memory GitHub from 0083 + fake `PlanStore`) — no real GitHub, no quota.

```bash
# from repo root
npm test -w @looper/plans
npm test -w @looper/core   # mapping totality + table
# bind unbound issue → task file + marker + Issue field created once
# re-bind → no duplicate file/marker (idempotent)
# label changed out of band → reconcileBinding rewrites Status to match label
# label==Status → reconcileBinding is a no-op
```

## Verification Log

- 2026-06-09: binding suite green: bind-once (file + marker + Issue: field,
  criteria carried verbatim), idempotent re-bind (no duplicate file/marker),
  marker→scan fallback resolution, drift reconcile (label authoritative,
  logged, no-op when equal).
- 2026-06-09: runner integration (plan-sync test): the marker lands on the
  issue and Status mirrors in-progress → implemented across dispatch/ingest.

## Decisions

- Marker format as specced: `<!-- looper:plan task=NNNN path=… -->` on the
  issue; `Issue: #N` header field on the task file; slug fallback scan via the
  Issue: field for hand-stripped markers.
- The label↔Status mapping lives in core (`state-machine/status-mirror.ts`),
  exactly the specced table (deploy sub-states collapse to merged; off-ramps +
  quarantine collapse to blocked; off-ramp wins over lifecycle state).
  Operational holds never rewrite Status.
- Drift resolution: the LABEL wins, always, with a logged Verification-Log
  note — GitHub is the control plane.
- Id allocation: max(active, archived) + 1 from the store scan (ids never
  reused); marker-present-but-file-deleted regenerates at the same id.

## Risks / Rollback

The drift-resolution direction is load-bearing: if the plan ever wins over the
label, the durable memory and the control plane diverge silently. Defense is the
single mapping table, label-authoritative reconcile, and a logged note on every
rewrite. A brittle marker parser desyncs binding — keep the marker format simple
and fail closed (route to `needs-human`) on ambiguous/duplicate bindings rather
than guessing. Rollback: the feature is additive (a marker + a file + a pure
table); disabling the runtime wiring stops new binds without corrupting existing
plans.

## Final Summary

`@looper/plans/binding`: bindIssue (idempotent generator from the 0015
template with criteria carried verbatim), two-way deterministic resolution
(marker → Issue:-field scan), and reconcileBinding (label-authoritative drift
repair with logging) over the core status-mirror table. Wired into the runner
so every transition keeps the pair in lockstep.
