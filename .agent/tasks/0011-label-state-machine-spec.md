# 0011 Label State Machine Spec

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Define loopdog's state machine as GitHub labels: a default state set, the legal
transition table, and how custom loops extend it — applied idempotently to any
repo.

## Background

Part of [Milestone 03](../milestones/milestone-03-github-state-machine-core.md).
Labels *are* the database and the state machine (no side store). Every loop is a
transition over this table; the transition runner (0012) and custom loops (M16 ·
0078) validate against it. See [architecture](../../docs/architecture.md) "The
state machine."

## Scope

- The default label set (states) + reserved off-ramps.
- The legal-transition table format and its config representation.
- Applying/reconciling labels on a repo (create missing, never clobber custom).
- Extension rules for custom loops adding states/transitions.

### Technical detail

Default states (label namespace `loopdog:state/*` to avoid collisions with the
adopter's own labels):

```
new · needs-grooming · needs-clarification · ready-for-agent ·
in-progress · in-review · changes-requested · verified · merged · deployed
(+ optional `scheduled` — an entry state for cron-triggered loops)
```

Built-in loop extension states are declared by the shipped loop assets and
reconciled with the same label machinery. V1 ships the deploy extension states
`deploying`, `deploy-failed`, and `rolled-back`; custom loops use the same
declaration path for their own states.

Reserved off-ramp labels (terminal/holding): `loopdog:blocked`, `loopdog:needs-human`,
`loopdog:stuck`, `loopdog:abandoned`. Plus operational labels: `loopdog:stop`
(kill switch), `loopdog:claimed-by/<run>` (claim marker, task 0013),
`loopdog:needs-approval` + `loopdog:approved` (authorization hold/release, M17),
`loopdog:parked` (budget/quota/kill-switch hold that preserves the lifecycle state),
and `loopdog:quarantine` (exhausted-failure hold, M19).

Transition table (config, with the default shipped):

```yaml
# rendered defaults; each entry = one legal edge a loop may drive
transitions:
  - { from: new,                 to: needs-grooming,      by: groom }
  - { from: needs-grooming,      to: needs-clarification, by: groom }     # ambiguous → ask
  - { from: needs-clarification, to: ready-for-agent,     by: groom }     # human replied
  - { from: needs-grooming,      to: ready-for-agent,     by: groom }
  - { from: ready-for-agent,     to: in-progress,         by: implement }
  - { from: in-progress,         to: in-review,           by: implement }
  - { from: in-review,           to: changes-requested,   by: review }    # review found gaps
  - { from: changes-requested,   to: in-progress,         by: fix }       # fix-and-revalidate
  - { from: in-review,           to: verified,            by: review }
  - { from: verified,            to: merged,              by: merge }
  - { from: merged,              to: deploying,           by: deploy }
  - { from: deploying,           to: deployed,            by: deploy-smoke }
  - { from: deploying,           to: deploy-failed,       by: deploy-smoke }
  - { from: deploy-failed,       to: rolled-back,         by: rollback }
  - { from: scheduled,           to: in-review,           by: <cron loop> }  # optional cron entry
  # any state → needs-human / blocked / stuck (off-ramps) is always legal
```

A loop's `transition: { from, to }` (its `loop.yml`) must match an edge here, or
`loopdog loops validate` rejects it. Custom loops may add edges/states; adding a
state requires it be declared so labels get created.

## Out Of Scope

- The runner that executes transitions (0012); claiming (0013); the gates that
  guard them (0014).

## Acceptance Criteria

- [x] A documented default state set + reserved off-ramps + operational labels
      (`core/src/state-machine/states.ts` — the spec from this task encoded).
- [x] A transition-table format with the default table shipped and overridable
      (`TransitionTable` + `DEFAULT_TRANSITION_TABLE` + `extendTable`).
- [x] `loopdog` creates missing state labels on a repo idempotently and never
      modifies labels it didn't create (`planLabelReconciliation` pure planner +
      `reconcileLabels` IO in `@loopdog/github`; double-run test proves no-diff).
- [x] An illegal `from→to` edge is rejected at validate time (`validateEdge` /
      `validateLoopTransition` — the entrypoint config validation and
      `loopdog loops validate` call); the runner also escalates rather than runs.
- [x] Custom loops can declare new states/edges (`extendTable`); declared
      states get labels via the same reconciliation.

## Implementation Checklist

- [x] Define the label namespace + default states/off-ramps/ops labels.
- [x] Define the transition-table schema; ship the default.
- [x] Implement idempotent label reconciliation against a repo.
- [x] Expose a validation entrypoint loops/CLI call to check an edge is legal
      (`validateEdge` for raw edges; `validateLoopTransition` for loop declarations,
      which also accepts a work-cell loop's two-edge path through `in-progress`).

## Test Plan

```bash
# replace with the chosen stack's runner
# apply labels to a scratch repo twice → no diff on second run
# assert an undeclared from→to edge fails validation
```

## Verification Log

- 2026-06-09: `npm test` — transition-table suite green: every default edge
  legal; undeclared edges rejected with reasons; unknown states named; off-ramps
  implicitly legal from any state; extension idempotent.
- 2026-06-09: label-reconciliation tests green: empty repo → full loopdog label
  set created; second run plans nothing; adopter labels (and adopter-recolored
  loopdog labels) never touched.

## Decisions

- Namespace exactly as specced: `loopdog:state/<name>` for lifecycle states;
  `loopdog:` prefix for off-ramps/operational; claim/lease/lock prefixes
  `loopdog:claimed-by/`, `loopdog:lease/`, `loopdog:lock/`.
- Off-ramp edges are **implicit** (any state → blocked/needs-human/stuck/
  abandoned is always legal) — enumerating them would bloat the table.
- A loop's declared transition validates as a direct edge OR (for dispatching
  loops) the canonical two-edge path `from → in-progress → to` — this is how
  `implement: ready-for-agent → in-review` is legal while raw `validateEdge`
  still rejects the chord.
- Reconciliation never updates/deletes — create-missing only. Adopter-modified
  loopdog label colors are left alone (the name is the contract, not the color).

## Risks / Rollback

Label collisions with the adopter's existing labels — the `loopdog:` namespace
plus never-clobber reconciliation is the mitigation.

## Final Summary

The state machine is encoded as data + pure functions in
`@loopdog/core/state-machine/` (default states incl. deploy extension states,
off-ramps, operational labels, the default transition table, edge + loop-path
validation, extension merging, and the never-clobber label planner) with the
IO application in `@loopdog/github/labels/`. Fully unit-tested including
idempotence and custom-loop extension.
