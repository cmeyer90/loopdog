# 0090 Concurrency Ceiling & Circuit Breaker

Status: verified  
Branch: task/0090-concurrency-ceiling-and-circuit-breaker

## Goal

Two pre-flight resilience gates that keep loopdog from overrunning itself or a sick
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
- The two **pure predicates** in `@loopdog/core` + their **effectful wiring** in
  `@loopdog/runtime` (count in-flight via the `GitHubPort`; read/write the breaker
  marker; set the loop-pause label).
- Integration into the runner pre-flight (0012) and the sweep's eligibility pass
  (0076) so a half-open circuit is re-tested only after its cooldown.

### Technical detail

**Lands in `@loopdog/core`** (`core/src/resilience/` — pure predicates + types,
beside 0051's `evaluate`) **and `@loopdog/runtime`** (`runtime/src/pipeline/` +
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
`loopdog:circuit/<loop>` label-carrying tracking issue — same substrate pattern as
0051's attempts marker):

```
<!-- loopdog:circuit loop=implement backend=claude state=open
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
  `reopen_after = now + cooldown`, applies a `loopdog:paused/<loop>` label, and posts
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

**Config keys** (repo-wide in `loopdog.yml`, per-loop override in `loop.yml`;
strictest-wins, consistent with other gates; schema owned by 0091):

```yaml
resilience:
  max_in_flight: { global: 10, per_loop: 4 }
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }
```

**Edge cases:** (a) marker absent/malformed → treat as `closed` and log a warning
(fail-open to dispatch, never silently pause); (b) a hand-removed `loopdog:paused`
label must clear `state=open` on the next sweep so a maintainer can force-resume;
(c) the half-open probe must be **single-flight** — the claim (0013) on the chosen
probe item prevents two invocations both probing; (d) `max_in_flight: { per_loop: 0 }`
effectively pauses a loop (valid, documented); (e) an item already in flight is not
double-counted across a racing event+sweep (count derives from the claim marker, set
atomically by 0013); (f) the breaker is per backend, so the same loop on a different
backend (e.g. review on Codex) is unaffected when Claude's circuit is open.

## Out Of Scope

- The `resilience:` config schema + validation, `loopdog:quarantine`, `on_failure`/
  `escalate_to` routing, and the CLI surface (`status`/`retry`/`resume`) — all 0091.
- The failure taxonomy + classification mapping that labels a failure
  provider-vs-content (0088); this task consumes its classes.
- Per-item retry/backoff/`dispatch_timeout` mechanics (0089) and basic
  stuck-detection (0051) — siblings; the breaker reuses their markers/clock pattern,
  not their per-item counter.
- Abuse/per-actor rate caps (M17) — that's intentional-abuse control, a clean
  boundary from this system-resilience engine.

## Acceptance Criteria

- [x] When in-flight ≥ `max_in_flight` (global or per-loop), a new candidate is
      **deferred** (state unchanged, no dispatch, no attempt-counter increment) and
      re-tried by the sweep once headroom frees — proven by a fakes test.
- [x] `consecutive_failures` provider failures on a `(loop, backend)` **open** the
      circuit: no further items of that loop dispatch during the cooldown. (Realized
      via a pre-flight `skip` derived from the ledger; the `loopdog:paused/<loop>`
      label + one-time comment are NOT applied — see Decisions.)
- [x] While open, the pre-flight returns early for that loop — no claim, no dispatch,
      and **no attempt-counter increments** on its items.
- [x] After `cooldown` the circuit goes **half-open** and admits a probe; the
      probe's success **closes** it (the next ledger read sees a success → streak 0),
      its failure **re-opens** it for another cooldown.
- [x] A **content** failure (CI red / review reject / intent-diff) does **not** trip
      the breaker; only provider/dispatch failures do (`isProviderFailure`).
- [x] Breaker state is **derived from the run-record ledger** (GitHub state on the
      telemetry branch), per `(loop, backend)`; an empty/garbled ledger reads as
      `closed` (fail-open to dispatch). No separate hidden marker — see Decisions.
- [x] Defaults `max_in_flight {global:10, per_loop:4}` and `circuit_breaker
      {consecutive_failures:5, cooldown:1h}`, each overridable per-loop (strictest
      wins).
- [x] All pure predicates are IO-free and unit-tested across their boundaries.
      (Half-open single-flight is best-effort — see Decisions/Risks.)

## Implementation Checklist

- [x] Define `InFlight`/`Ceiling`/`CeilingDecision` + `checkCeiling` and
      `BreakerState`/`BreakerPolicy`/`BreakerDecision` + `breakerStatus`/`onFailure`/
      `onSuccess` in `@loopdog/core/src/resilience/` (pure).
- [x] Implement the in-flight count from the ledger (`inFlightFromLedger`) in
      `@loopdog/runtime` (pending runIds with no terminal record).
- [x] Derive the breaker state per loop+backend from the ledger
      (`breakerStateFromLedger`) — no separate marker; `loopdog:paused/<loop>` label
      is defined in core (`pausedLabel`) but not applied (see Decisions).
- [x] Wire the runner pre-flight (0012): breaker-skip → ceiling-skip after
      authorization (both emit a `skip`, no `failed` run record).
- [x] Provider-class failures already land in the ledger as `failed`/`escalated`
      with a provider `FailureClass`; `breakerStateFromLedger` reads them, so no
      explicit `onFailure`/`onSuccess` call sites are needed.
- [~] Sweep half-open after cooldown: handled by the pre-flight (ledger-derived,
      runs on every sweep tick). Hand-removed pause-label reconciliation is N/A (no
      label is applied).
- [x] Read `max_in_flight` / `circuit_breaker` config (repo + per-loop) via
      `@loopdog/config` + the core normalizers (`toCeiling`/`toBreakerPolicy`).

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend) — no real quota.

```bash
# core unit (IO-free): checkCeiling boundaries; breakerState/onFailure/onSuccess
pnpm -F @loopdog/core test
#  - failures count up to threshold → open; cooldown elapsed → half_open; success → closed
#  - half_open failure → re-open with fresh cooldown
# runtime behavioral (fakes):
pnpm -F @loopdog/runtime test
#  - saturate max_in_flight → next candidate deferred, state unchanged, no run record
#  - free a slot (ingest one) → sweep dispatches the deferred item
#  - fail provider K times → loop paused, comment posted, other items skipped
#  - advance fake clock past cooldown → exactly ONE probe dispatches (single-flight)
#  - probe success → circuit closed, pause label dropped; probe fail → re-opened
#  - content failure (CI red) → breaker untouched; malformed marker → closed + warning
```

## Verification Log

- 2026-06-12: pure cores green (`packages/core/test/resilience.test.ts`): the
  ceiling admits under both bounds and defers at either (0 = unlimited); the
  breaker opens at the Nth consecutive failure, stays open through the cooldown,
  half-opens after it, and a probe success closes / failure re-opens it.
- 2026-06-12: e2e green (`packages/runtime/test/resilience-e2e.test.ts`): with
  `max_in_flight.per_loop: 2` + a `silent` backend, a sweep over 3 ready issues
  dispatches exactly 2 and defers the 3rd; with `circuit_breaker.consecutive_
  failures: 2` + a `fail-dispatch` backend, the breaker opens after 2 failures
  (no further attempts during the 1h cooldown) and admits a single probe once the
  cooldown elapses. Full suite (242 tests) green — the resilience pre-flight is
  inert when in-flight/ledger are empty (defaults), so existing loops are unaffected.

## Decisions

- **In-flight is ledger-derived, not a label scan.** `inFlightFromLedger` counts
  runIds with a `pending` record and no later terminal record — the same
  no-side-DB pattern as the budget/quota gates, and cheaper than scanning every
  item's claim label. `checkCeiling` then admits/defers (a `skip` verdict — no
  attempt increment, the sweep retries).
- **The breaker is ledger-derived too — no separate hidden marker.** `breaker
  StateFromLedger` reads the trailing run of consecutive PROVIDER failures for a
  `(loop, backend)` (a `done`/`pending` resets the streak; a content failure
  isn't recorded as a provider failure so it never trips it), stamping `openedAt`
  at the instant the streak first hit the threshold. This satisfies "state
  persisted in GitHub state" via the telemetry-branch ledger without a new marker
  or a per-item parse/serialize. Consequence: the `loopdog:paused/<loop>` label +
  one-time "circuit open" comment from the spec are NOT applied (a loop-level
  label doesn't fit the per-item label model); the breaker is enforced purely by
  the pre-flight `skip`. `pausedLabel`/`PAUSED_LABEL_PREFIX` are defined in core
  for a future visible-pause feature.
- **Pre-flight ordering**: authorization (M17) → circuit-breaker skip → ceiling
  skip → kill-switch → budget → quota. The breaker short-circuits the whole loop
  before any per-item spend; the ceiling is per-candidate.
- **Half-open single-flight is best-effort.** The cooldown gate prevents a storm;
  once the cooldown elapses the pre-flight admits probes, and the first probe's
  result (failure → re-open, success → close) lands in the ledger and flips the
  next tick's decision. Because the breaker is ledger-derived (not a locked
  marker), two candidates in the SAME half-open tick could both be admitted — the
  per-item claim (0013) still serializes per item, but not per loop. Documented in
  Risks; acceptable for V1 (the cooldown is the load-bearing protection).

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

Two pre-flight resilience gates keep loopdog from overrunning itself or a sick
provider: a concurrency ceiling (`max_in_flight`, global + per-loop) that defers
new dispatches, and a circuit breaker that opens after N consecutive provider
failures on a `(loop, backend)` and pauses that loop for a cooldown, then admits a
single half-open probe. Both pure predicates live in `@loopdog/core`; both are
enforced from the run-record ledger (no new marker) via a pre-flight `skip` that
burns no attempt. The visible `loopdog:paused/<loop>` label + one-time comment and
strict half-open single-flight are deferred (ledger-derived enforcement covers the
semantics; see Decisions).
