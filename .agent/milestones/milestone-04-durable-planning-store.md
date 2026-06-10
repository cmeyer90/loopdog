# Milestone 04: Durable Planning Store

Status: planned

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
| 0015 | planned | task/0015-portable-plan-format | Portable Plan Format | Configurable plan-store layout + task/milestone templates looper emits. |
| 0016 | planned | task/0016-issue-to-plan-binding | Issue ↔ Plan Binding | Generator linking each issue to a plan; label↔Status mirroring. |
| 0017 | planned | task/0017-plan-lifecycle-automation | Plan Lifecycle Automation | Open/update/verify/archive transitions driven by the loops. |
| 0018 | planned | task/0018-plan-index-maintenance | Plan Index Maintenance | Automatic upkeep of the plan + milestone indexes. |

## Definition Of Done

- Looper creates a linked plan (milestone for epics, task/subtasks per issue) in
  a configurable store path.
- Issue labels and plan `Status` stay synchronized through the lifecycle.
- Plans are opened, updated, and archived automatically as items move.
- The plan and milestone indexes stay accurate without manual edits.

## Verification Log

Add dated entries as tasks land.
