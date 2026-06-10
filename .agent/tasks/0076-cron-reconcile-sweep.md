# 0076 Cron Reconcile Sweep

Status: planned  
Branch: task/0076-cron-reconcile-sweep

## Goal

Make the system **correct and complete**: a scheduled pass that scans the board,
advances any item events missed, and drives the transitions only a clock can —
the resilience half of the dual-trigger model.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md);
the counterpart to event triggers (0008). See [architecture](../../docs/architecture.md)
"Triggering: events for latency, cron for resilience." Pattern: Kubernetes-style
*watch + periodic resync* — events watch, the sweep resyncs.

## Scope

- A scheduled Actions workflow (`on: schedule: cron`) that runs the controller.
- A reconcile scan: for each state, find eligible items and advance them one
  transition (idempotent, claim-protected).
- Drive time-based transitions; configurable interval, scan bounds, and no-op
  behavior.
- Define the sweep contract for loop-level cron triggers, parked/deferred retry,
  scan order, and crash recovery.

### Technical detail

- **Mechanism:** one scheduled workflow (`on: schedule`; GitHub's ~5-minute
  granularity, may lag or skip under load) invokes the same controller (M03 · 0012)
  as events do, with `trigger.kind = "cron"` and actor `system`. The workflow uses
  root config `sweep.interval` (default `*/5 * * * *`; friendly `every: 5m`
  normalizes to cron) and may also expose `workflow_dispatch` for manual/debug
  ticks. An empty tick scans metadata only and makes **no model/provider dispatch**.
- **Loop-level cron triggers:** a loop with `trigger.cron` does **not** create a
  separate workflow. The sweep evaluates cron-triggered loops during the same pass:
  if the loop's schedule is due for the item in its current `from` state, that loop
  becomes a candidate. Missed/delayed Actions ticks coalesce into the next sweep;
  the source of truth remains GitHub state, not an in-memory timer. V1 cron loops
  still advance one declared transition, so an item normally leaves the `from` state
  after acting; recurring same-state cron work would require widening 0012's
  idempotency key with a schedule slot and is out of scope here.
- **Scan order and bounds:** load config, group loops by `transition.from`, and
  query each distinct non-terminal `looper:state/*` label once. Build `(loop,item)`
  candidates only when the item's state matches the loop's `from` state and the
  loop trigger filter passes (event loops are eligible on every reconcile pass as a
  backstop; cron loops only when due). Process candidates in a stable bounded order:
  state-machine order, then loop declaration/name order, then oldest eligible item
  timestamp + item number. Apply configurable caps (`sweep.max_candidates_per_tick`
  and, for large boards, `sweep.max_candidates_per_state`); hitting a cap defers
  remaining candidates to later sweeps and is logged in the sweep summary.
- **Eligibility:** the sweep pre-filters only durable "not yet" state, then delegates
  final gates to the runner pre-flight (0012, 0050/0075, M17, M19). It skips items
  with no lifecycle label, multiple lifecycle labels, terminal/off-ramp labels
  (`looper:needs-human`, `looper:blocked`, `looper:abandoned`,
  `looper:stuck`, `looper:quarantine`), an unresolved approval hold
  (`looper:needs-approval` without trusted `looper:approved`), an active
  non-expired claim/lease, or a future timer (`not_before`, `retryAfter`,
  schedule-window `until`, circuit `reopen_after`). When a timer has passed, the
  item is re-evaluated rather than blindly dispatched; the corresponding gate may
  clear the hold or park/defer it again with a fresh reason.
- **Parked/deferred retry:** `looper:parked` is an operational hold, not a lifecycle
  state. Budget/quota/rate/window parks carry `retryAfter`/`until` and are retried
  at or after that time; kill-switch parks have no retry time and stay held until
  the stop signal clears; approval holds stay held until a trusted release; overload
  (`max_in_flight`) defers without incrementing attempts and is retried next tick.
  In every case the lifecycle state label remains in place so the sweep knows the
  original transition to retry, and parking/defer never increments the failure
  counter.
- **Crash and timer maintenance:** each tick reconciles time-based state before
  dispatching new work. A dispatch whose `dispatch_deadline` passed first checks
  for a correlated PR (ingest wins); if none exists, the sweep records a transient
  timeout through 0089/0051 and releases the claim. A claim whose lease expired and
  has no dispatch-timeout marker is reclaimed per 0013. Open circuits remain
  skipped until `reopen_after`; half-open circuits admit exactly one probe candidate.
- **Reconcile:** after pre-filtering, ask "is there a loop that should advance this,
  and does it pass the runner pre-flight?" If so → claim (M03 · 0013) → run exactly
  one transition (M03 · 0012). Idempotency and atomic claims make racing an event on
  the same item safe; the loser observes the claim/advanced state and no-ops.
- **The three jobs the sweep owns:**
  1. **Resilience backstop** — recover items a dropped/delayed webhook stranded.
  2. **Controller→controller handoff** — pick up items whose state looper's own
     `GITHUB_TOKEN` changed (which doesn't re-trigger event workflows). *This is
     why no GitHub App is needed* (0008, M07).
  3. **Time-based transitions** — backoff re-attempts + stuck escalation (M19),
     lease-expiry reclaim of crashed runs (M03 · 0013), `looper:parked`
     retry-after holds from budget/quota, quarantine/schedule-window timers — none
     of which any event represents.
- **Safety/idempotency:** the scan itself is read-mostly and provider-free. A sweep
  runs at most one transition per item per tick; if a candidate mutates state, later
  candidates for that item are dropped. Every acted item is re-read before claim,
  claim losers release/abort cleanly, and run records/summaries are idempotent on
  `run_id`/comment markers. Extra, delayed, or duplicate sweeps are therefore safe.

## Out Of Scope

- Event triggers (0008); the transition pipeline (M03 · 0012); claiming internals
  (M03 · 0013).
- Recurring same-state cron loops that intentionally keep an item in the same
  `from` state after acting; those need a schedule-slot idempotency extension in
  the runner.

## Acceptance Criteria

- [ ] A scheduled workflow runs the controller; an empty tick is a cheap no-op.
- [ ] Per-loop `trigger.cron` schedules are evaluated inside the sweep, not by
      creating separate workflows.
- [ ] The reconcile scan has a deterministic order and configurable per-tick /
      per-state caps, with cap hits reported instead of silently truncating.
- [ ] Eligibility skips terminal/off-ramp items, unresolved holds, active leases,
      future timers, and malformed state-label cases; due holds are re-evaluated
      through pre-flight rather than blindly dispatched.
- [ ] The reconcile scan advances eligible items by exactly one transition,
      idempotently and claim-protected (safe to race events).
- [ ] It recovers webhook-missed items, carries `GITHUB_TOKEN` controller→controller
      handoffs, and drives time-based transitions (backoff/lease/parked holds/
      schedule windows/circuit cooldown/quarantine).
- [ ] The sweep interval is configurable.

## Implementation Checklist

- [ ] Author the scheduled workflow + interval config.
- [ ] Implement loop-level cron schedule evaluation inside the sweep pass.
- [ ] Implement the by-state reconcile scan over eligible items with stable order
      and configurable caps.
- [ ] Implement hold/timer eligibility (`not_before`, `retryAfter`, schedule
      `until`, lease expiry, circuit cooldown, approval/kill-switch holds).
- [ ] Drive time-based transitions (dispatch timeout, backoff, lease-expiry,
      parked-hold, schedule-window, circuit half-open, quarantine/retry timers).
- [ ] Ensure no-op ticks are cheap (no model calls).

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# strand an item (suppress its event) → next sweep advances it
# expire a lease → sweep reclaims; empty board → no-op
# cron loop due → sweep selects it; cron loop not due → skipped
# parked quota item before retryAfter → skipped; after retryAfter → re-evaluated
# event and sweep race one item → exactly one claim/dispatch
# cap hit → remaining candidates deferred and cap reported
```

## Verification Log

- 2026-06-09: Planning review against 0012, 0013, 0050, 0075, 0089-0091, 0051,
  0080, 0082, and `docs/architecture.md`; clarified the sweep contract in this
  plan. No code checks run (planning-doc-only change).

## Decisions

Record the interval default, loop-level cron due semantics, the scan strategy and
scaling caps, the parked/deferred hold marker shape, the time-based transitions the
sweep owns, and whether recurring same-state cron loops remain out of scope or
widen 0012's idempotency key.

## Risks / Rollback

- On a huge board the scan could be expensive each tick — bound it (scan only
  non-terminal states, cap items/tick and per-state) and log any cap so coverage
  is not silently truncated.
- A bad hold parser could either wedge items or dispatch too early — malformed
  timer/hold markers should fail toward "skip and report" for operational holds,
  while malformed attempt counters follow 0051's explicit fail-open rule.
- Cron schedule semantics can become ambiguous for same-state recurring work; keep
  V1 to one state-advancing transition unless 0012 explicitly adds schedule-slot
  idempotency.

## Final Summary

Fill this in before marking verified.
