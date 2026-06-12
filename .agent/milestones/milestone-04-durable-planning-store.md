# Milestone 04: Durable Planning Store

Status: verified

> Background: [Looper Architecture](../../docs/architecture.md) — "Durable
> planning store (plans-as-memory)." Productizes the milestones+tasks system this
> repo uses on itself.

## Objective

Let looper write and maintain durable plans (milestones + tasks) inside any target
repo, bind every issue/epic to a plan, and keep the issue label and plan `Status`
in sync — giving the loops inspectable working memory that survives across
sessions and workers.

## Guiding Decisions

- The plan format is portable and the store path is configurable per adopter.
- Every body of work gets a milestone + task (or subtasks); the issue label
  mirrors the task `Status`.
- Loops, not humans, maintain these plans through the lifecycle (open → update →
  archive), following the protocol in `../PLANS.md`.
- The plan store is the durable memory; GitHub is the control plane; they never
  disagree.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0015 | verified | task/0015-portable-plan-format | Portable Plan Format | Configurable plan-store layout + task/milestone templates looper emits. |
| 0016 | verified | task/0016-issue-to-plan-binding | Issue ↔ Plan Binding | Generator linking each issue to a plan; label↔Status mirroring. |
| 0017 | verified | task/0017-plan-lifecycle-automation | Plan Lifecycle Automation | Open/update/verify/archive transitions driven by the loops. |
| 0018 | verified | task/0018-plan-index-maintenance | Plan Index Maintenance | Automatic upkeep of the plan + milestone indexes. |

## Definition Of Done

- [x] Looper creates a linked plan per issue in a configurable store path
  (0015 format + 0016 binding; epics' milestone files use the shipped
  milestone template — automated epic decomposition is M08 grooming's job).
- [x] Issue labels and plan `Status` stay synchronized through the lifecycle
  (core status-mirror table + label-authoritative reconcile, proven across
  dispatch→ingest in the runner wiring test).
- [x] Plans are opened, updated, and archived automatically as items move
  (0017 lifecycle ops wired into the runner write-back behind the EffectGate).
- [x] The plan and milestone indexes stay accurate without manual edits
  (0018 projection; the rebuild is authoritative and heals hand-edits).

## Verification Log

- 2026-06-09: all four tasks verified; 100 tests green repo-wide (plans format/
  binding/lifecycle/index suites + the runner plan-sync wiring test).
- 2026-06-09: the wiring test caught a REAL stranding bug: a dispatched item in
  `in-progress` was invisible to the sweep (loops scanned only their from-
  state). Fixed: work-cell loops now scan their dispatched intermediate state
  (`scanStates`) in both the runner and the sweep grouping — regression-tested.
