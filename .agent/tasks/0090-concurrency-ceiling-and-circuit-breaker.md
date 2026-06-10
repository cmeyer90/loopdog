# 0090 Concurrency Ceiling & Circuit Breaker

Status: planned  
Branch: task/0090-concurrency-ceiling-and-circuit-breaker

## Goal

Two pre-flight resilience gates that keep looper from overrunning itself or a sick
provider: a **concurrency ceiling** (`max_in_flight`) that defers dispatch when too
much work is already in flight, and a **circuit breaker** that, after N consecutive
provider failures, *opens* (pauses the loop) for a cooldown instead of burning more
attempts and quota on an outage.

## Background

Part of [Milestone 19](../milestones/milestone-19-resilience-and-failure-policy.md)
— the `overload` (defer) and provider-outage classes of the failure taxonomy
(0088), and the `max_in_flight` / `circuit_breaker` rows of the `resilience:` block.
See [architecture](../../docs/architecture.md#resilience--failure-policy): *"a
circuit breaker beats blind retries during a provider outage (pause, don't burn
quota); a load spike defers past `max_in_flight` rather than overrunning."*

These are the **counting/outage** mechanisms; they generalize the per-item attempt
counter from stuck-detection (0051) to a **per-(loop, backend)** consecutive-failure
streak, and add a **board-wide in-flight count**. They sit in the runner's
pre-flight, alongside the gates (M03 0014), authorization (M17), and budget/quota
(M12 0050) — *before* any claim or dispatch (0012). The knobs they read are owned
and validated by 0091; the terminal quarantine/escalation surface is 0091. This
task ships the *engine*; 0091 ships the *config block + CLI*.

## Scope

- A **concurrency ceiling**: count items in flight (globally + per loop) and, when
  at/over the limit, **defer** the candidate (leave it eligible, no dispatch) rather
  than overrun.
- A **circuit breaker** per `(loop, backend)`: track a consecutive-failure streak;
  at `consecutive_failures` open the circuit and pause the loop for `cooldown`; a
  success while half-open closes it.
- The two **pure predicates** in `@looper/core` + their **effectful wiring** in
  `@looper/runtime` (count in-flight via the `GitHubPort`; read/write the breaker
  marker; set the loop-pause label).
- Integration into the runner pre-flight (0012) and the sweep's eligibility pass
  (0076) so a half-open circuit is re-tested only after its cooldown.

### Technical detail

**Lands in `@looper/core`** (`core/src/resilience/` — pure predicates + types,
beside 0051's `evaluate`) **and `@looper/runtime`** (`runtime/src/pipeline/` +
`runtime/src/sweep/` — the in-flight count, the breaker marker IO over the existing
`GitHubPort`, the pause label). No new IO port.

**Concurrency ceiling — count, don't queue (GitHub is the store).** There is no
queue; "in flight" is derived from board state: items carrying the in-progress
claim/lease marker (0013) for an *acting* loop, i.e. dispatched but not yet
ingested/terminal. The runtime counts these with one labels query per pass and
caches it for the invocation.

```ts
type InFlight = { global: number; perLoop: number };
type Ceiling  = { global: number; perLoop: number };   // from config max_in_flight
type CeilingDecision = { kind: 'ok' } | { kind: 'defer'; reason: 'global' | 'per_loop' };

function checkCeiling(now: InFlight, cap: Ceiling): CeilingDecision;
```

A `defer` is **not a failure**: the item keeps its state, the attempt counter
(0051) is untouched, no run record `failed` is emitted (a lightweight `deferred`
step is logged), and the sweep retries it next tick once headroom frees up.
Defaults `global: 10, per_loop: 4`. Selection is deterministic (stable item order)
so the same items win the slots across racing invocations; the claim (0013) is the
real race guard — the ceiling only throttles *new* claims.

**Circuit breaker — per `(loop, backend)`, not per item.** A provider outage hurts
every item, so the streak is keyed by the *provider*, not the issue. State lives in
a single hidden marker in a durable per-loop location (the loop's state issue, or a
`looper:circuit/<loop>` label-carrying tracking issue — same substrate pattern as
0051's attempts marker):

```
<!-- looper:circuit loop=implement backend=claude state=open
     consecutive_failures=5 opened_at=2026-06-08T14:00:00Z
     reopen_after=2026-06-08T15:00:00Z last_run=run_91c -->
```

```ts
type BreakerState = { failures: number; openedAt?: Date };   // persisted
type BreakerPolicy = { consecutiveFailures: number; cooldown: Seconds }; // config
type BreakerDecision =
  | { kind: 'closed' }                    // dispatch allowed
  | { kind: 'open'; until: Date }         // paused — skip, do not dispatch
  | { kind: 'half_open' };                // cooldown elapsed → allow ONE probe

function breakerState(s: BreakerState, p: BreakerPolicy, now: Date): BreakerDecision;
function onFailure(s: BreakerState, p: BreakerPolicy, now: Date): BreakerState; // ++, maybe open
function onSuccess(s: BreakerState): BreakerState;  // reset to closed, failures=0
```

- **Closed → Open**: the runner's failed-step path calls `onFailure`; when the
  streak hits `consecutive_failures` the runtime sets `state=open`, stamps
  `reopen_after = now + cooldown`, applies a `looper:paused/<loop>` label, and posts
  a one-time comment ("circuit open: provider `claude` failed N× — paused until
  HH:MM"). While open, the pre-flight returns early — **no claim, no dispatch, no
  attempt-counter increments** on any item of that loop.
- **Open → Half-open**: once `reopen_after` passes, the next sweep tick treats the
  circuit as half-open and lets **exactly one** probe dispatch through. Other items
  stay deferred until the probe resolves.
- **Half-open → Closed / Open**: the probe's success calls `onSuccess` (failures→0,
  drop the pause label, post "circuit closed"); its failure re-opens for another
  cooldown (capped/optionally backed-off cooldown to avoid hammering a long outage).
- **What counts as a failure** for the streak: provider/dispatch failures —
  `dispatch_timeout` with no correlated PR (0073), provider-error mid-dispatch, and
  terminal provider classes from the taxonomy (0088). A *content* failure (CI red,
  review rejection, intent-diff mismatch) is **not** a provider outage and must not
  trip the breaker; only `transient`/`terminal` *provider* classes feed `onFailure`.

**Ordering in pre-flight** (cheapest-and-most-protective first): kill-switch/budget
(0050) → **circuit breaker** (skip the whole loop if open) → authorization (M17) →
DoR/DoD gate (0014) → **concurrency ceiling** (defer this item) → claim (0013) →
dispatch. The breaker is checked before per-item work because an open circuit means
*nothing* in the loop should dispatch; the ceiling is per-item because headroom is
shared.

**Sweep integration (0076):** the eligibility pass consults `breakerState` once per
loop (skip the loop's items entirely while `open`; allow one probe while
`half_open`) and `checkCeiling` per item (defer over-limit candidates). This is a
time-based transition the sweep owns — the cooldown clock only advances on sweep
ticks, mirroring 0051's backoff clock.

**Config keys** (repo-wide in `looper.yml`, per-loop override in `loop.yml`;
strictest-wins, consistent with other gates; schema owned by 0091):

```yaml
resilience:
  max_in_flight: { global: 10, per_loop: 4 }
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }
```

**Edge cases:** (a) marker absent/malformed → treat as `closed` and log a warning
(fail-open to dispatch, never silently pause); (b) a hand-removed `looper:paused`
label must clear `state=open` on the next sweep so a maintainer can force-resume;
(c) the half-open probe must be **single-flight** — the claim (0013) on the chosen
probe item prevents two invocations both probing; (d) `max_in_flight: { per_loop: 0 }`
effectively pauses a loop (valid, documented); (e) an item already in flight is not
double-counted across a racing event+sweep (count derives from the claim marker, set
atomically by 0013); (f) the breaker is per backend, so the same loop on a different
backend (e.g. review on Codex) is unaffected when Claude's circuit is open.

## Out Of Scope

- The `resilience:` config schema + validation, `looper:quarantine`, `on_failure`/
  `escalate_to` routing, and the CLI surface (`status`/`retry`/`resume`) — all 0091.
- The failure taxonomy + classification mapping that labels a failure
  provider-vs-content (0088); this task consumes its classes.
- Per-item retry/backoff/`dispatch_timeout` mechanics (0089) and basic
  stuck-detection (0051) — siblings; the breaker reuses their markers/clock pattern,
  not their per-item counter.
- Abuse/per-actor rate caps (M17) — that's intentional-abuse control, a clean
  boundary from this system-resilience engine.

## Acceptance Criteria

- [ ] When in-flight ≥ `max_in_flight` (global or per-loop), a new candidate is
      **deferred** (state unchanged, no dispatch, no attempt-counter increment) and
      re-tried by the sweep once headroom frees — proven by a fakes test.
- [ ] `consecutive_failures` provider failures on a `(loop, backend)` **open** the
      circuit: the loop is paused (`looper:paused/<loop>`), no further items of that
      loop dispatch, and a one-time comment is posted.
- [ ] While open, the pre-flight returns early for that loop — no claim, no dispatch,
      and **no attempt-counter increments** on its items.
- [ ] After `cooldown` the circuit goes **half-open** and lets exactly **one** probe
      through; the probe's success **closes** it (failures→0, pause label dropped),
      its failure **re-opens** it for another cooldown.
- [ ] A **content** failure (CI red / review reject / intent-diff) does **not** trip
      the breaker; only provider/dispatch failures do.
- [ ] Breaker state is persisted in GitHub state (hidden marker), per `(loop,
      backend)`; an absent/malformed marker is treated as `closed` and logged.
- [ ] Defaults `max_in_flight {global:10, per_loop:4}` and `circuit_breaker
      {consecutive_failures:5, cooldown:1h}`, each overridable per-loop (strictest
      wins).
- [ ] All pure predicates are IO-free and unit-tested across their boundaries; the
      half-open probe is single-flight under a racing event+sweep.

## Implementation Checklist

- [ ] Define `InFlight`/`Ceiling`/`CeilingDecision` + `checkCeiling` and
      `BreakerState`/`BreakerPolicy`/`BreakerDecision` + `breakerState`/`onFailure`/
      `onSuccess` in `@looper/core/src/resilience/` (pure).
- [ ] Implement the in-flight count (labels/claim-marker query, cached per pass) in
      `@looper/runtime`.
- [ ] Implement the circuit marker parse/serialize (per loop+backend) over the
      `GitHubPort`; apply/drop the `looper:paused/<loop>` label.
- [ ] Wire the runner pre-flight (0012): breaker-skip → ceiling-defer in the
      documented order; emit a `deferred` step (not a `failed` run record).
- [ ] Wire the failed-step path to feed only provider-class failures into
      `onFailure`; wire success to `onSuccess`.
- [ ] Wire the sweep (0076) to half-open after cooldown and admit a single probe;
      reconcile hand-removed pause labels.
- [ ] Read `max_in_flight` / `circuit_breaker` config (repo + per-loop,
      strictest-wins) via `@looper/config` (schema from 0091).

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend) — no real quota.

```bash
# core unit (IO-free): checkCeiling boundaries; breakerState/onFailure/onSuccess
pnpm -F @looper/core test
#  - failures count up to threshold → open; cooldown elapsed → half_open; success → closed
#  - half_open failure → re-open with fresh cooldown
# runtime behavioral (fakes):
pnpm -F @looper/runtime test
#  - saturate max_in_flight → next candidate deferred, state unchanged, no run record
#  - free a slot (ingest one) → sweep dispatches the deferred item
#  - fail provider K times → loop paused, comment posted, other items skipped
#  - advance fake clock past cooldown → exactly ONE probe dispatches (single-flight)
#  - probe success → circuit closed, pause label dropped; probe fail → re-opened
#  - content failure (CI red) → breaker untouched; malformed marker → closed + warning
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the in-flight derivation (claim-marker count vs. label), the circuit marker
format + key (`loop`+`backend`), the half-open single-probe rule, the cooldown
re-open policy (fixed vs. backed-off), and the pre-flight ordering.

## Risks / Rollback

- **Mis-counting in-flight** double-throttles or never throttles — derive the count
  from the same claim marker (0013) the idempotency path uses, and test it against
  racing event+sweep invocations.
- **Stuck-open circuit** if the cooldown clock and `reopen_after` desync — keep the
  comparison in the pure predicate, test against the fake clock, and let a
  hand-removed pause label force-resume.
- **Tripping on content failures** would pause a loop for non-provider problems —
  gate `onFailure` to provider/dispatch classes only (0088); this is the key
  correctness boundary.
- Rollback: additive and per-gate. Disable the ceiling with very high
  `max_in_flight`; disable the breaker with a very high `consecutive_failures` (it
  never opens) — both leave the rest of the pipeline intact.

## Final Summary

Fill this in before marking verified.
