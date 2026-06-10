# 0017 Plan Lifecycle Automation

Status: planned  
Branch: task/0017-plan-lifecycle-automation

## Goal

Make the loops — not humans — drive a plan through its lifecycle: **open** a plan
when work is groomed, **update** it as the work cell progresses, advance its
`Status` on **verify**, and **archive** it on terminal states — each transition
idempotent, append-only where possible, and always consistent with GitHub state.

## Background

Part of [Milestone 04](../milestones/milestone-04-durable-planning-store.md):
"Plans are opened, updated, and archived automatically as items move." Builds on
the portable plan format (0015) and the issue↔plan binding + label↔Status
mirroring (0016); feeds the index maintenance (0018). This is the *behavioral*
layer over the `PlanStore` port (defined in @looper/core, 0094) — it sequences
the read/write calls that 0015/0016 expose into lifecycle transitions the runner
invokes. See [architecture](../../docs/architecture.md) "Durable planning store
(plans-as-memory)" — "the plan store is the durable memory; GitHub is the control
plane; they never disagree" — and the planning protocol in [`../PLANS.md`](../PLANS.md)
(status values, completion rules, archive rules), which this task automates.

Lands primarily in **@looper/plans** (the lifecycle operations over `PlanStore`)
with wiring in **@looper/runtime** (the transition pipeline + sweep call these
operations as part of write-back).

## Scope

- A small set of **lifecycle operations** over `PlanStore`, each mapping a state
  transition to a deterministic plan mutation: `open`, `update`, `verify`,
  `archive`.
- The runner's write-back step (0012) and the ingest path (0073) call the right
  operation for the transition being applied; the sweep (0076) drives time-based
  ones (e.g. archive-on-merged it missed).
- Idempotency + append-only semantics so an event and a sweep re-applying the
  same transition produce one effect.
- `Status` advancement that obeys the `../PLANS.md` status ladder and stays in
  lockstep with the issue label (0016 owns the mirror; this owns the plan side).

### Technical detail

**Lifecycle operations** (in `@looper/plans/src/lifecycle/`, called by the
runtime pipeline, not by loop authors):

| Operation | Triggered on transition | Plan mutation |
|---|---|---|
| `open(item)` | grooming → `ready-for-agent` (DoR passed, 0014) | create the task file (+ milestone if epic) from the 0015 template; set `Status: ready`; write the acceptance-criteria block |
| `update(item, runRecord, patch)` | any in-flight step (`in-progress`, ingest from 0073) | append a dated **Verification Log** entry; check off Implementation-Checklist / Acceptance-Criteria items the patch names; never rewrite prior lines |
| `verify(item)` | DoD passed (0014) → `verified` | set `Status: verified`; ensure every acceptance criterion is checked; fill **Final Summary** from the run record |
| `archive(item, terminal)` | `merged` / `abandoned` | set `Status: merged`/`abandoned`; move the file `tasks/<id>.md` → `archive/tasks/<id>.md` per the archive rules; leave a tombstone ref so the binding (0016) still resolves |

**Status ↔ transition mapping** lives as a single table in
`@looper/core/src/state-machine` (the states already exist there, 0011) so the
plan `Status` and the `looper:state/*` label derive from the *same* source — they
cannot drift. `update` does **not** touch `Status`; only `open`/`verify`/`archive`
move it, mirroring 0016's label writes in the same transition.

**Idempotency.** Each operation keys off the durable plan's current content, not
an external flag: `open` is a no-op if the task file already exists; `verify` is a
no-op if `Status` is already `verified`; `archive` is a no-op if the file already
lives under `archive/`. `update` is **append-only and content-addressed** — a
Verification Log entry carries the `run_id`; re-applying the same `run_id` appends
nothing. This makes event↔sweep races safe (the architecture's idempotent-
transition guarantee, M03), the same way the runner short-circuits (0012).

**Atomic write-back.** A lifecycle mutation, the label write (0016), and any
index update (0018) for one transition are committed in a **single commit** by the
controller (as `GITHUB_TOKEN`) so the plan store and GitHub never half-update. On
commit conflict, re-read and re-derive (the operations are idempotent), don't
force-push.

**Edge cases:** a transition whose plan was hand-deleted → `open` recreates a
stub and logs a warning (the binding from 0016 is authoritative); a back-transition
(`changes-requested` after `verified`) → `Status` drops back to `in-progress` and
`verify` will re-run, never deleting prior log entries; a terminal label set by a
human directly on the issue → the sweep (0076) reconciles by calling `archive`.

## Out Of Scope

- The plan file format / templates (0015); the issue↔plan binding + label↔Status
  mirror writes (0016); index file upkeep (0018).
- The `PlanStore` port signatures (0094); grooming that *generates* criteria (M08).
- The DoR/DoD predicates themselves (0014) — this consumes their verdicts.

## Acceptance Criteria

- [ ] Grooming reaching `ready-for-agent` (DoR passed) opens a task file with
      `Status: ready` and the acceptance-criteria block, idempotently.
- [ ] An in-flight step appends a dated, `run_id`-keyed Verification Log entry and
      checks off named checklist/criteria items without rewriting prior lines.
- [ ] DoD passing advances the plan to `Status: verified` with Final Summary filled
      and every criterion checked.
- [ ] A `merged`/`abandoned` item moves its file under `archive/` and sets the
      terminal `Status`, leaving the binding (0016) still resolvable.
- [ ] Every operation is idempotent: re-applying the same transition (event then
      sweep) yields exactly one effect, proven by a double-apply test.
- [ ] Plan `Status` and the issue label derive from one shared mapping and never
      diverge across a full lifecycle.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add the Status↔transition mapping in `@looper/core/src/state-machine`.
- [ ] Implement `open`/`update`/`verify`/`archive` in `@looper/plans/src/lifecycle/`
      over the `PlanStore` port.
- [ ] Make `update` append-only + `run_id`-keyed; make all four idempotent off plan
      content.
- [ ] Wire the operations into the runtime write-back (0012) and ingest (0073) paths,
      and the sweep (0076) for missed terminal transitions.
- [ ] Commit lifecycle + label + index changes atomically per transition.
- [ ] Update docs if the lifecycle behavior or protocol surface changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(in-memory `PlanStore` + fake GitHub, 0083) — no real quota, no real GitHub.

```bash
# replace with this repo's checks
npm test -w @looper/plans
# scenario: groom→open, dispatch→update, DoD→verify, merge→archive on fake GitHub
# double-apply each transition (event then sweep) → single effect (idempotent)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the four lifecycle operations' exact signatures, the Status↔transition
mapping location, the `run_id`-keyed append-only rule for `update`, and the
single-commit atomicity decision.

## Risks / Rollback

The core risk is plan↔GitHub divergence (the milestone's "they never disagree"
invariant). Defenses: one shared Status↔label mapping, idempotent content-addressed
operations, and single-commit write-back; the sweep (0076) is the backstop that
reconciles any missed transition. Rollback is safe because operations are
idempotent and `update` is append-only — re-running never corrupts a plan; revert
the wiring in @looper/runtime to disable lifecycle automation while leaving the
`PlanStore` reads intact.

## Final Summary

Fill this in before marking verified.
