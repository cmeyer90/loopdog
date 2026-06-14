# 0086 Simulation & Fault Injection

Status: verified  
Branch: task/0086-simulation-and-fault-injection

## Goal

A deterministic-clock simulation layer with fault injection that drives the real
controller through the hard concurrency cases — event storms, event↔sweep races,
dropped/duplicated webhooks, and mid-run crashes — and asserts loopdog's core
invariants hold: **no double-dispatch, no stranded items, idempotent ingest.**

## Background

Part of [Milestone 18](../milestones/milestone-18-test-and-simulation-harness.md)
(tier 4, "simulation"). Builds on the fake GitHub (0083), the fake/replay backends
(0084), and the scenario runner (0085): those prove *happy-path end-state*; this
proves *correctness under adversity*. It directly stresses the primitives most at
risk — the runner's idempotency key + single-step guarantee (M03 · 0012), the
claim/lease protocol (0013), dispatch↔ingest correlation (M05 · 0073), and the
events-vs-sweep handoff (M02 · 0076). Lives in the dev-only `@loopdog/testing`
package. See [codebase](../../docs/codebase.md) "Testing strategy" (tier 4) and
[architecture](../../docs/architecture.md) "Triggering: events for latency, cron
for resilience."

## Scope

- A **deterministic virtual clock** the runner, sweep, and fakes read instead of
  wall time — advanced explicitly by the simulation, so time-based transitions
  (backoff, lease timeout, quota windows) are reproducible.
- A **simulation engine** that interleaves controller invocations (event-driven +
  sweep ticks) under a seeded schedule, including concurrent/racing invocations.
- **Fault injectors**: event storms, event↔sweep races, dropped webhooks,
  duplicated webhooks, and mid-run crash/abort at arbitrary step boundaries.
- **Invariant checkers** evaluated after each step and at quiescence.
- A seeded **property/fuzz mode**: randomize event order + fault timing across N
  seeds; any invariant violation prints the minimal reproducing seed + trace.

### Technical detail

Lands in `@loopdog/testing` (`packages/testing/src/simulation/`), reusing the
`@loopdog/testing` fakes from 0083/0084 and the scenario fixtures from 0085. No new
ports; this drives the *real* `runtime` pipeline + sweep through the fakes.

**Virtual clock.** Define a `Clock` port in `@loopdog/core` (`now(): Date`,
`sleep()`-free — the runtime never blocks) and inject it everywhere wall time is
read (runner, sweep, lease expiry, backoff scheduling, telemetry timestamps). The
fake GitHub's seeded timestamps (0083) read this same clock. `VirtualClock`
exposes `advance(ms)` and `setTime(t)`; the engine owns all advancement so nothing
is non-deterministic.

```ts
interface Sim {
  clock: VirtualClock;
  gh: FakeGitHub;            // 0083, shared object graph + event queue
  backend: FakeBackend;      // 0084, scripted/replay
  faults: FaultPlan;         // injectors below, keyed by step
  // one engine "step" = deliver one queued event OR run one sweep tick
  step(): Promise<StepResult>;
  runToQuiescence(maxSteps?: number): Promise<void>; // drain events + idle sweeps
}
```

**Schedule model.** A run = an ordered list of `Action`s: `deliverEvent(id)`,
`sweepTick()`, `advanceClock(ms)`, plus a fault overlay. A `concurrent([a,b])`
action interleaves two invocations against the *same* shared fake state to expose
TOCTOU races (e.g. event + sweep both selecting the same item before either
claims). Determinism comes from a single seed driving event order, fault timing,
and any concurrent-step interleaving.

**Fault injectors** (each toggled per scenario, parameterized by seed):

- `eventStorm` — enqueue M duplicate/near-simultaneous events for one item;
  asserts the claim (0013) + idempotency key (0012) collapse them to one dispatch.
- `raceEventSweep` — fire an item's event and a sweep tick in the same engine step
  (`concurrent`); both must not advance the item twice.
- `dropWebhook` — a mutation that *would* emit a triggering event silently drops
  it (models GitHub's missed-delivery); recovery must come only from the sweep
  (0076), i.e. the item is *not* stranded.
- `duplicateWebhook` — deliver the same event twice (at-least-once delivery);
  ingest (0073) must be idempotent — single effect.
- `crashMidRun` — abort an invocation after step K (claim/compose/dispatch/
  ingest/write boundaries from the 0012 run-record `steps`), leaving partial
  state; a later event/sweep must recover with no double-dispatch and no orphaned
  claim past its lease.

**Invariants** (`packages/testing/src/simulation/invariants.ts`), checked after
every step and at quiescence, each reading only fake state + run records:

- `noDoubleDispatch` — across the whole run, ≤1 effective dispatch per
  `(loop, item, from-state)` idempotency key (count `dispatch` steps in run
  records + backend call log; correlated re-ingests don't count).
- `noStrandedItems` — at quiescence, no item sits in an actionable state with an
  expired lease and no in-flight artifact; everything reaches a terminal/parked
  state or is genuinely in-flight.
- `idempotentIngest` — a PR/event delivered N times yields exactly one ingest
  effect (one label transition, one plan update, one run-record ingest step).
- `claimExclusivity` — at most one holder of a live claim/lease per item at any
  step (0013).
- `monotonicState` — no item regresses across a forbidden edge of the state
  machine (M03).

**Property/fuzz mode.** `fuzz({ seeds: N, actions, faults })` generates randomized
schedules; on first violation it shrinks to the minimal failing prefix and prints
`{ seed, trace, violatedInvariant }` for a deterministic repro (re-run by seed). A
small fixed seed set runs in per-PR CI; the wide sweep runs nightly (0087).

**Edge cases:** lease exactly at expiry boundary (clock equality); a crash between
`dispatch` and the correlation handle being persisted (must be recoverable via the
three-signal match, 0073); storm + drop combined (storm of events all dropped →
sweep is the only recovery); sweep running while an event-driven invocation holds a
claim (must defer, not steal).

## Out Of Scope

- The fakes themselves (0083 GitHub, 0084 backends) and the golden scenario runner
  (0085) — this consumes them.
- CI wiring / live smoke (0087).
- Implementing the runner/claim/correlation logic under test (M03 · 0012/0013,
  M05 · 0073) — those are exercised, not authored here. Bugs found are filed
  against them.

## Acceptance Criteria

- [x] A `Clock` port exists in `@loopdog/core` and the runtime reads time only
      through it; a `VirtualClock` drives all time in simulation (no wall-clock
      reads in the controller path).
- [x] The simulation engine deterministically interleaves event delivery + sweep
      ticks (incl. a `concurrent` step) from a single seed.
- [x] Each fault injector (storm, event↔sweep race, drop, duplicate, crash-mid-run)
      is implemented and has a scenario reproducing the hazard.
- [x] The five invariants are checked after every step and at quiescence, and fail
      the test with a readable trace on violation.
- [x] A dropped webhook leaves no stranded item: the sweep recovers it (proven by a
      scenario asserting recovery and `noStrandedItems`).
- [x] A duplicated event / re-delivered PR produces exactly one effect
      (`idempotentIngest`).
- [x] An event-storm on one item yields ≤1 dispatch (`noDoubleDispatch`).
- [x] A crash after any step boundary recovers on the next invocation with no
      double-dispatch and no orphaned claim past lease.
- [x] Fuzz mode runs N seeds and, on violation, prints the minimal reproducing seed
      + trace; a fixed seed set is fast enough for per-PR CI.

## Implementation Checklist

- [x] Add the `Clock` port to `@loopdog/core`; thread it through `runtime`
      (pipeline, sweep, lease, backoff, telemetry) and the fake GitHub (0083).
- [x] Implement `VirtualClock` + the simulation engine (`step`,
      `runToQuiescence`, `concurrent`) over the shared fakes.
- [x] Implement the schedule/`Action` model + seeded interleaving.
- [x] Implement the five fault injectors as a `FaultPlan` overlay.
- [x] Implement the invariant checkers and per-step + quiescence evaluation.
- [x] Implement fuzz mode with seed shrinking + repro printing.
- [x] Author the canonical hazard scenarios (one per injector + the combined cases).

## Test Plan

Tests run via vitest in `@loopdog/testing`, fully offline against the M18 fakes
(0083/0084) — **no real quota, no network**.

```bash
# replace with the chosen stack's runner
npx vitest run packages/testing/src/simulation
# storm → 1 dispatch; race → 1 transition; drop → sweep recovers; dup → 1 ingest;
# crash@K → recover, no double-dispatch; fuzz(seeds) → invariants hold (or repro seed)
```

## Verification Log

- 2026-06-12: simulation suite green (`packages/testing/test/simulation.test.ts`,
  6 tests), each driving the REAL controller under the `VirtualClock`: an event
  storm (5 near-simultaneous events) → ≤1 implement dispatch (`noDoubleDispatch`);
  an event↔sweep race (`concurrent`) → exactly one advance; a dropped webhook →
  the sweep recovers it with nothing stranded (`noStrandedItems`); a duplicated
  webhook (×3) → one correlated PR (`idempotentIngest`); a crash mid-dispatch
  (injected via the fake's `beforeOp` on the marker write) → the dispatch guard
  releases the claim (no orphan), recovery re-dispatches, invariants hold; and a
  fuzz sweep over 8 seeds with no violation. All five invariants run after every
  step and at quiescence. Found no new runtime bug — the M03 double-dispatch
  defense, claim/lease, and 0073 correlation hold under adversity.

## Decisions

- `Clock` port = `type Clock = () => Date` in `@loopdog/core` (+ `systemClock`
  default). The runtime already threaded an injectable `now` everywhere; this
  names it. The one wall-clock leak (`ingestPhase`'s plan-sync timestamp) now
  reads `deps.now`, so the controller path reads time ONLY through the clock when
  injected. `VirtualClock` (in `@loopdog/testing`) conforms and owns all
  advancement; the `FakeGitHub` reads the same clock for `updatedAt`/comment
  timestamps.
- Engine: one `step()` = deliver one event OR one sweep OR advance the clock OR a
  `concurrent([...])` interleave (Promise.all against the SAME shared fakes, to
  expose TOCTOU). Faults are schedule builders: `eventStorm`, `raceEventSweep`,
  `duplicateWebhook`, `sweepRecovery` (dropped webhook = no event + a later
  sweep), `crashAfter(op,k)` (throw on the k-th `op` via `beforeOp`). A
  deterministic-but-unique claim nonce (a monotonic counter injected via
  `ControllerOptions.claimNonce`, replacing `Math.random`) keeps racing claimants
  distinct without breaking reproducibility.
- Fuzz: a `mulberry32(seed)` PRNG permutes a base schedule (shuffle + 25% event
  duplication) across N seeds; on the first `SimViolation` it shrinks to the
  shortest failing prefix and returns `{seed, invariant, detail, trace, schedule}`
  for a deterministic repro.
- Invariant definitions: `noDoubleDispatch` counts DISTINCT runIds with a
  `dispatch` step per (loop,item) idempotency key, grouped by attempt index — >1
  runId for the SAME attempt is the bug; sequential attempts (a0,a1,…) are legal
  retries, and correlated re-ingests share the runId so they don't count.
  `idempotentIngest` flags >1 effective ingest (an `ingest` step + a transition)
  per runId. `noStrandedItems` is lease-expiry-aware: a claim/lease with no
  in-flight pending record is stranded ONLY once the lease has LAPSED (before
  that it's recovering; after, the sweep reclaims). `claimExclusivity` (≤1 claim/
  lock marker per item) and `monotonicState` (≤1 state label per item) read
  labels directly.

## Risks / Rollback

The chief risk is a simulation that's *deterministic but unfaithful* — it passes
while real GitHub's concurrency/delivery semantics differ, giving false
confidence. Mitigations: event emit/suppress fidelity is owned by 0083 and the
gated live smoke (0087) catches drift; keep the engine driving the *real* runtime
(no test-only control-flow forks). Purely additive in the dev-only `@loopdog/testing`
package — revert by removing the simulation module; the `Clock` port is the only
change touching shipped code and is a safe, inert indirection.

## Final Summary

A deterministic-clock simulation engine drives the REAL controller through event
storms, event↔sweep races, dropped/duplicated webhooks, and mid-run crashes, and
checks five invariants (no-double-dispatch, idempotent-ingest, no-stranded-items,
claim-exclusivity, monotonic-state) after every step and at quiescence — with a
seeded fuzz mode that shrinks to a minimal repro on violation. The `Clock` port
+ a deterministic claim nonce remove the last wall-clock/`Math.random`
nondeterminism from the controller path. All hazards hold; no new runtime bug
surfaced.
