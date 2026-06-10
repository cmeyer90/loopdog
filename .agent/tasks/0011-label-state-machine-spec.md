# 0011 Label State Machine Spec

Status: planned  
Branch: task/0011-label-state-machine-spec

## Goal

Define looper's state machine as GitHub labels: a default state set, the legal
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

Default states (label namespace `looper:state/*` to avoid collisions with the
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

Reserved off-ramp labels (terminal/holding): `looper:blocked`, `looper:needs-human`,
`looper:stuck`, `looper:abandoned`. Plus operational labels: `looper:stop`
(kill switch), `looper:claimed-by/<run>` (claim marker, task 0013),
`looper:needs-approval` + `looper:approved` (authorization hold/release, M17),
`looper:parked` (budget/quota/kill-switch hold that preserves the lifecycle state),
and `looper:quarantine` (exhausted-failure hold, M19).

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
`looper loops validate` rejects it. Custom loops may add edges/states; adding a
state requires it be declared so labels get created.

## Out Of Scope

- The runner that executes transitions (0012); claiming (0013); the gates that
  guard them (0014).

## Acceptance Criteria

- [ ] A documented default state set + reserved off-ramps + operational labels.
- [ ] A transition-table format with the default table shipped and overridable.
- [ ] `looper` creates missing state labels on a repo idempotently and never
      modifies labels it didn't create.
- [ ] An illegal `from→to` edge is rejected at config-validate time, not runtime.
- [ ] Custom loops can declare new states/edges; declared states get labels.

## Implementation Checklist

- [ ] Define the label namespace + default states/off-ramps/ops labels.
- [ ] Define the transition-table schema; ship the default.
- [ ] Implement idempotent label reconciliation against a repo.
- [ ] Expose a validation entrypoint loops/CLI call to check an edge is legal.

## Test Plan

```bash
# replace with the chosen stack's runner
# apply labels to a scratch repo twice → no diff on second run
# assert an undeclared from→to edge fails validation
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the label namespace, default state names, and whether off-ramp edges are
implicit (any→off-ramp) or enumerated.

## Risks / Rollback

Label collisions with the adopter's existing labels — the `looper:` namespace
plus never-clobber reconciliation is the mitigation.

## Final Summary

Fill this in before marking verified.
