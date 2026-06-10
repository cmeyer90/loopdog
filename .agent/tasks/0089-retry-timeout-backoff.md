# 0089 Retry, Timeout & Backoff

Status: planned  
Branch: task/0089-retry-timeout-backoff

## Goal

Turn the basic attempt-counter/backoff primitive (M12 · 0051) into the full,
config-driven retry engine M19 needs: honor `resilience.retries` (max + backoff
shape) for `transient` failures, enforce `dispatch_timeout` so a dispatch with no
correlated PR is escalated rather than stranded, and compute the next-attempt
clock from configurable backoff — all driven by the cron sweep, never an in-process
busy loop.

## Background

Part of [Milestone 19](../milestones/milestone-19-resilience-and-failure-policy.md)
— row 0089 "Retry, Timeout & Backoff": *per-dispatch retries, `dispatch_timeout`,
configurable backoff*. This generalizes the **smallest correct** stuck-detection
of 0051 (a single hardcoded exponential schedule + one escalation edge) into the
tunable `resilience.retries`/`dispatch_timeout` knobs. It consumes the failure
**class** from the taxonomy (0088) — only `transient` retries; `terminal`/`poisoned`
do not — and leaves the user-facing `resilience:` block, quarantine, and CLI to
0091; concurrency + circuit breaker to 0090. See
[architecture](../../docs/architecture.md#resilience--failure-policy) and
"Triggering: events for latency, cron for resilience." Lands the pure logic in
`@looper/core` (`core/src/resilience/`) and the effectful side in `@looper/runtime`,
reusing the `GitHubPort` — no new IO port.

## Scope

- **Configurable backoff**: replace 0051's hardcoded formula with one driven by
  `resilience.retries` (`max`, `backoff: exponential|linear|constant`, `base`,
  `cap`) + full jitter. Per-class: only `transient` (0088) consumes a retry budget.
- **Per-dispatch retry budget**: `retries.max` bounds re-dispatches of a single
  dispatch (distinct from 0051's `max_attempts_per_item`, the item-level ceiling).
- **`dispatch_timeout`**: a dispatch with no correlated PR (0073) by the deadline is
  a timed-out attempt → counts against the retry/attempt budget → backoff or escalate.
- **Sweep-driven clocks**: the sweep (0076) re-arms a backed-off item and detects a
  timed-out dispatch on its tick; the runner (0012) records failures and writes the
  next-attempt marker. No busy-wait inside one invocation.

## Out Of Scope

- The failure taxonomy + class→response mapping (0088) — this task only *reads* the
  class and acts on `transient`/timeout.
- `max_in_flight` defer + circuit breaker (0090).
- The `resilience:` config surface, `looper:quarantine`, `on_failure` routing,
  `escalate_to` notification, and CLI (`looper status`/`retry`) — 0091.
- Item-level escalation edge + `resetAttempts` mechanics (owned by 0051; this task
  extends its types and schedule, it does not re-own them).

### Technical detail

**Configurable backoff (pure, in `@looper/core/src/resilience/`).** Generalize
0051's `nextBackoff` to read the `retries` policy. Extend, don't fork, its types:

```ts
type BackoffShape = 'exponential' | 'linear' | 'constant';
type RetryPolicy = {                 // from resilience.retries (0091 loads it)
  max: number;                       // per-dispatch retry budget (default 2)
  backoff: BackoffShape;             // default 'exponential'
  base: Seconds;                     // default 30
  cap: Seconds;                      // default 600 (10m)
};
// exponential: base * 2^(n-1); linear: base * n; constant: base — all min(., cap),
// then full jitter random(0, computed) to avoid sweep-synchronized thundering herds.
function nextBackoff(attempt: number, p: RetryPolicy, rnd?: () => number): Seconds;
```

The decision predicate stays the shape 0051 defined (`evaluate(s, p, now)` →
`eligible | backoff{until} | escalate`); 0089 widens `Policy` to carry the
`RetryPolicy` + per-dispatch retry count alongside 0051's item-level `maxAttempts`.
**Two distinct budgets** (both honored, strictest wins): `retries.max` bounds one
dispatch's re-fires; `max_attempts_per_item` (0051) bounds the item across dispatches.
Exhausting `retries.max` on a `transient` failure rolls into the item attempt
counter; exhausting that hits 0051's escalation edge.

**Dispatch timeout (effectful, in `@looper/runtime`).** When the runner dispatches
(0073), it stamps a deadline `dispatch_started + dispatch_timeout` into the
attempts marker (extend 0051's hidden issue-body block with a `dispatch_deadline`
field; keyed by `loop`, survives re-labeling). The **sweep** (0076), per tick,
checks each in-flight dispatch: if `now > dispatch_deadline` and no correlated PR
exists (0073's matcher returns none), the dispatch is a **timed-out attempt** —
release the claim (0013), record a run record with `outcome.status: failed` and a
synthetic class `transient` (a no-PR timeout is retryable), and run `recordFailure`
→ backoff or escalate. This is the same path 0073 describes for "no correlated PR
within the lease," now governed by `dispatch_timeout` rather than only the raw lease.

**Marker extension** (0051's `<!-- looper:attempts ... -->`), additive fields:

```
<!-- looper:attempts loop=implement count=2 not_before=2026-06-08T14:32:00Z
     dispatch_deadline=2026-06-08T15:02:00Z retry_count=1
     first_failed=... last_run=run_91c last_class=transient -->
```

**Config keys** (repo-wide `looper.yml`, per-loop `loop.yml`, strictest-wins; full
block + validation owned by 0091, this task consumes a forward-compatible subset
via `@looper/config`):

```yaml
resilience:
  retries: { max: 2, backoff: exponential, base: 30s, cap: 10m }
  dispatch_timeout: 30m
```

**Integration points.** (a) Runner on dispatch → stamp `dispatch_deadline`.
(b) Runner on a failed step → if class is `transient` and `retry_count < retries.max`,
`recordFailure` sets `not_before` via `nextBackoff(retry_count)` and `++retry_count`;
else roll into item attempts (0051). (c) Sweep per tick → re-arm items whose
`not_before` passed; detect+escalate items whose `dispatch_deadline` passed with no PR.

**Edge cases:** (a) a PR that arrives *just after* the deadline but *before* the
sweep escalates must still ingest (0073) and clear the marker — ingest wins over
timeout (check-for-PR happens inside the sweep's escalation, not optimistically).
(b) `backoff: constant` + `base: 0` is legal (immediate retry) but still re-armed
by the *sweep*, never busy-looped. (c) `dispatch_timeout` shorter than the claim
lease (0013) is honored (timeout is the tighter bound); longer is clamped to the
lease so a stale claim can't outlive its lease. (d) non-`transient` class never
consumes a retry — it goes straight to 0051/0088's terminal path. (e) malformed
`dispatch_deadline` → treat as expired and re-check for a PR (fail toward
re-evaluation, never silent drop), logging a warning.

## Acceptance Criteria

- [ ] Backoff is driven by `resilience.retries` (`max`/`backoff`/`base`/`cap`) with
      full jitter; `exponential`/`linear`/`constant` shapes each produce the
      documented schedule, capped, and per-loop override wins (strictest).
- [ ] A `transient` failure (0088) consumes the per-dispatch retry budget and is
      re-armed by the sweep after `not_before`; a non-`transient` class consumes no
      retry and routes to the terminal path.
- [ ] A dispatch with no correlated PR (0073) by `dispatch_timeout` is detected by
      the sweep, the claim released, and recorded as a timed-out (`transient`)
      attempt — not stranded and not double-dispatched.
- [ ] A PR arriving before the sweep escalates ingests normally and clears the
      timeout marker (ingest wins over timeout).
- [ ] Exhausting `retries.max` rolls into the item attempt counter (0051); no
      in-process busy-retry occurs — all re-attempts are sweep-driven.
- [ ] `dispatch_timeout` is clamped to never exceed the claim lease (0013).
- [ ] Defaults (`retries.max: 2`, `exponential`, `base: 30s`, `cap: 10m`,
      `dispatch_timeout: 30m`) apply with no config; all overridable per-loop.

## Implementation Checklist

- [ ] Extend `@looper/core/src/resilience/` types with `RetryPolicy`/`BackoffShape`
      and generalize `nextBackoff` (3 shapes + jitter); keep 0051's `evaluate` shape.
- [ ] Add per-dispatch `retry_count` budget to the decision predicate, distinct from
      the item-level `maxAttempts` (both honored, strictest wins).
- [ ] Extend the attempts marker (parse/serialize) with `dispatch_deadline` +
      `retry_count` over the `GitHubPort` in `@looper/runtime`.
- [ ] Stamp `dispatch_deadline` on dispatch; wire the failed-step path to the
      `transient`-vs-terminal branch.
- [ ] Implement the sweep's timeout check (no-PR-by-deadline → release claim +
      record `transient` timeout → backoff/escalate), with ingest-wins ordering.
- [ ] Load the `resilience.retries`/`dispatch_timeout` subset via `@looper/config`
      (repo + per-loop, strictest-wins), forward-compatible with 0091's full block.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend + fake clock) — no real quota.

```bash
# core unit (IO-free): nextBackoff across 3 shapes × boundaries (base/cap/jitter)
pnpm -F @looper/core test
#  - exponential 30s base → 30,60,120,...,cap 600; linear/constant schedules
#  - retry budget vs item budget: which exhausts first, strictest wins
# runtime behavioral (fakes): retry + timeout end-to-end
pnpm -F @looper/runtime test
#  - transient fail → marker retry_count=1, not_before set, item skipped until clock
#  - advance fake clock past not_before → sweep re-dispatches
#  - dispatch with no PR; advance clock past dispatch_deadline → sweep escalates,
#    claim released, run record = transient timeout
#  - PR arrives before escalation tick → ingest wins, marker cleared
#  - non-transient class → no retry consumed, terminal path
#  - dispatch_timeout > lease → clamped to lease
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the three backoff-shape formulas + jitter choice, the two-budget split
(`retries.max` per-dispatch vs `max_attempts_per_item` item-level) and which wins,
the `dispatch_deadline` marker format, the ingest-wins-over-timeout ordering, and
the lease-clamp rule.

## Risks / Rollback

- **Double-dispatch on timeout race** — a PR landing as the sweep escalates could
  both ingest and re-dispatch. Mitigate by re-checking for a correlated PR (0073)
  *inside* the sweep's escalation and by the 0012 idempotency key; both must hold.
- **Thundering herd** — many items re-arming on the same sweep tick; full jitter on
  `nextBackoff` defends it.
- **Over-retry burning quota** — a misclassified `terminal` treated as `transient`
  loops on the provider; the budget cap + 0088's classification bound it.
- Rollback: additive over 0051. Disable by setting `retries.max: 0` (no retries,
  straight to item-attempt path) and `dispatch_timeout` to the lease (no tighter
  timeout); both revert to 0051's behavior.

## Final Summary

Fill this in before marking verified.
