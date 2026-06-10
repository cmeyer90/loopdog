# Milestone 03: GitHub State-Machine Core

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "The state
> machine" and the core principle (controller vs. work cell). Lands mostly in
> `@looper/core` (pure logic) + `@looper/runtime` (effectful pipeline) — see
> [Codebase Layout](../../docs/codebase.md).

## Objective

Build the vendor-neutral engine core: a configurable label state machine, a
stateless transition runner that reads/writes GitHub, atomic claiming with
per-area serialization, and machine-checkable Definition-of-Ready / Done gates.

## Guiding Decisions

- Labels are states; loops are pure transitions. No side database.
- The label scheme is configurable but ships a sensible default set.
- Deterministic code owns claiming, budgets, retries, and gates; the model owns
  only the creative work inside a transition.
- Claiming is atomic (assign-to-bot + state label) to stop interval loops
  double-picking.
- Transitions are **idempotent and re-entrant**, so the same item can be driven
  safely by either an event trigger or the cron reconcile sweep (M02); re-running
  an already-applied transition is a no-op.
- **Loops are declarative**: custom loops may declare new states and transitions,
  and the engine validates every transition against the configured table, rejecting
  illegal ones. The generic runner executes any declared loop without core changes.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0094 | planned | task/0094-core-port-interfaces-and-run-record-store | Core Port Interfaces & Run-Record Store | (Build step 1) The five `@looper/core` port interfaces as real TS + the run-record store decision. |
| 0011 | planned | task/0011-label-state-machine-spec | Label State Machine Spec | Configurable label set + legal-transition table applied to a repo. |
| 0012 | planned | task/0012-transition-runner | Stateless Transition Runner | The worker shell: read state → run one idempotent transition → write back; safe under event or sweep invocation. |
| 0013 | planned | task/0013-atomic-claiming-and-serialization | Atomic Claiming & Serialization | Lock protocol preventing double-pick and same-area collisions. |
| 0014 | planned | task/0014-dor-dod-contract-gates | DoR / DoD Contract Gates | Programmatic readiness/done checks loops enforce at transitions. |

## Definition Of Done

- A documented, configurable label set + legal transitions are enforced; illegal
  transitions are rejected.
- A stateless runner advances any item exactly one step and is safe to re-run.
- Two concurrent runs cannot claim the same item; same-area work is serialized.
- DoR and DoD are evaluated programmatically and block transitions when unmet.

## Verification Log

Add dated entries as tasks land.
