# Milestone 03: GitHub State-Machine Core

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) — "The state
> machine" and the core principle (controller vs. work cell). Lands mostly in
> `@loopdog/core` (pure logic) + `@loopdog/runtime` (effectful pipeline) — see
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
| 0094 | verified | task/0094-core-port-interfaces-and-run-record-store | Core Port Interfaces & Run-Record Store | (Build step 1) The five `@loopdog/core` port interfaces as real TS + the run-record store decision. |
| 0011 | verified | task/0011-label-state-machine-spec | Label State Machine Spec | Configurable label set + legal-transition table applied to a repo. |
| 0012 | verified | task/0012-transition-runner | Stateless Transition Runner | The worker shell: read state → run one idempotent transition → write back; safe under event or sweep invocation. |
| 0013 | verified | task/0013-atomic-claiming-and-serialization | Atomic Claiming & Serialization | Lock protocol preventing double-pick and same-area collisions. |
| 0014 | verified | task/0014-dor-dod-contract-gates | DoR / DoD Contract Gates | Programmatic readiness/done checks loops enforce at transitions. |

## Definition Of Done

- [x] A documented, configurable label set + legal transitions are enforced;
  illegal transitions are rejected (validate-time + runner escalation).
- [x] A stateless runner advances any item exactly one step and is safe to
  re-run (double-invocation + race tests).
- [x] Two concurrent runs cannot claim the same item; same-area work is
  serialized (claim race + serialize_by tests).
- [x] DoR and DoD are evaluated programmatically and block transitions when
  unmet (gate suite + runner DoR routing test).

## Verification Log

- 2026-06-09: all five tasks verified. `npm test` 59 passing across core
  (transition table, claim protocol, gates, decision), github (claims races +
  label reconciliation + event parsing), runtime (runner end-to-end on fake
  GitHub + scripted fake backend). `npm run build` + `npm run lint` green.
- 2026-06-09: two real bugs caught by the suites and fixed: (1) lease-label
  encoding corrupted ISO timestamps (dropped the encoding; labels permit ':');
  (2) deterministic runIds let event-vs-sweep races double-dispatch — fixed
  with invocation-unique claimant nonces in the claim CAS (see 0013).
- 2026-06-09: note — the M18 fakes (FakeGitHub 0083, FakeBackend 0084 core)
  were built alongside, as planned ("18 is built alongside from the start").
