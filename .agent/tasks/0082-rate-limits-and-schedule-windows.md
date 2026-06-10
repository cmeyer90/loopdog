# 0082 Rate Limits & Schedule Windows (WHEN)

Status: planned  
Branch: task/0082-rate-limits-and-schedule-windows

## Goal

Bound **when** acting loops may fire: enforce per-actor and global trigger rate
caps and optional schedule windows as a pre-flight gate, so a burst of triggers
(human or bot) cannot drain the maintainer's subscription quota and so loops only
run inside chosen hours — coordinating with, not duplicating, the budget/quota
gate (M12 · 0050/0075).

## Background

Part of [Milestone 17](../milestones/milestone-17-authorization-and-trigger-control.md);
this milestone owns the **intentional/abuse** half of "when" (system-load and
provider-failure controls — `max_in_flight`, circuit breaker — are M19). The runner
(M03 · [0012](0012-transition-runner.md)) calls this in pre-flight, *after* actor
authorization ([0079](0079-actor-authorization-policy.md)) and trigger-source
controls ([0081](0081-trigger-source-and-bot-controls.md)) but *before*
claim/dispatch. See [architecture](../../docs/architecture.md#authorization--trigger-control)
"When — per-actor + global trigger rate caps and optional schedule windows."

This is access control, distinct from cost: M12 caps *spend/quota* against the
provider; 0082 caps *trigger frequency* per actor and globally, and confines
firing to allowed hours. Both are pre-flight gates; this task defers to M12's
verdict when both apply (see Decisions).

## Scope

- A rate-limiter gate: per-actor-per-day and global-per-hour trigger caps, with
  state derived from GitHub (no DB).
- A schedule-window gate: allowed weekdays / hours / timezone for a loop.
- Repo-default (`looper.yml`) + per-loop override; **strictest applicable wins**
  (consistent with 0079).
- A decision the pre-flight pipeline consumes: `allow` | `defer` (try later via the
  sweep) | `park` (needs-approval) — never silent spend.
- The cron "system" actor and the reconcile sweep ([0076](0076-cron-reconcile-sweep.md))
  are **exempt from per-actor caps** but still honor the schedule window for the
  loop they're advancing.

### Technical detail

Lands as a gate in **`@looper/core`** (`core/src/gates/`), pure and IO-free,
returning a decision the runner enforces; config schema in **`@looper/config`**;
the runner wires it in **`@looper/runtime`** (`runtime/src/pipeline/`). Counting
reads GitHub via the `GitHubPort` (**`@looper/github`**) — no database.

Config (root default, per-loop overridable; per M17 Guiding Decisions):

```yaml
authorization:
  rate_limit: { per_actor_per_day: 5, global_per_hour: 20 }   # omit/0 = unlimited
  schedule_window: { days: [mon-fri], hours: "09-18", tz: "America/Los_Angeles" }
```

**Decision type** (consumed by 0012; sibling of 0079's decision):

```ts
type WhenDecision =
  | { verdict: "allow" }
  | { verdict: "defer"; until?: ISO8601; reason: string }   // retry via sweep
  | { verdict: "park";  reason: string }                     // needs-approval hold
```

**Rate counting without a DB** — derive counts from GitHub, the only store:

- A **dispatch/claim ledger** already exists as the run records + claim labels/
  comments the runner writes (0012/0013). The limiter counts *effective dispatches*
  (transitions that spent), not raw events, by querying:
  - `per_actor_per_day`: dispatches attributed to `actor` within a rolling 24h
    window (search the repo's run-record comments / claim markers carrying
    `looper-run:` + actor, filtered by timestamp).
  - `global_per_hour`: all effective dispatches repo-wide in the rolling 60m window.
- Attribution: the triggering actor is the one 0079 resolved; cron-originated
  transitions are tagged `system` and excluded from per-actor counts.
- **Over a cap →** by default `defer` (the trigger is acknowledged; the sweep
  reattempts once the window has rolled — no spend, no loss). A per-loop
  `on_rate_limit: park` may instead route to needs-approval (reuses 0080's hold).

**Schedule windows** — evaluate the trigger's wall-clock time against the loop's
window in the configured `tz` (use a fixed tz database; no host-locale dependence):

- `days`: ranges/lists of weekdays (`mon-fri`, `[sat, sun]`); `hours`: `"HH-HH"`
  24h ranges (wrap past midnight supported, e.g. `"22-06"`).
- Outside the window → `defer` with `until` set to the next window opening, so the
  sweep picks it up at the right time rather than busy-deferring. Inside → `allow`.
- A loop with no `schedule_window` is always in-window.

**Strictest-wins merge** (per-loop ∪ repo default): take the **lower** numeric cap
and the **intersection** of schedule windows; a per-loop window can narrow but not
widen the repo default unless explicitly set (mirrors 0079's tighten-not-loosen).

**Coordination with M12 budget/quota** (0050/0075): both gates run in pre-flight.
Order: actor (0079) → source (0081) → **rate/window (0082)** → budget/quota (M12).
0082's `defer` and M12's quota-throttle both mean "not now, retry via sweep"; the
runner takes the **most restrictive** verdict and the **latest** `until`. 0082 does
not re-implement quota math — it only caps trigger frequency and hours.

**Edge cases:** clock skew (count on rolling windows from `now`, tolerate ±1 step);
DST transitions in the window tz (resolve via tz database, not fixed offsets); an
actor right at the cap when the sweep also wants to advance (sweep/system is exempt
from per-actor, still bound by window); a deferred item that becomes eligible again
must not double-count (idempotency key from 0012 makes re-evaluation safe).

## Out Of Scope

- Actor trust resolution (0079); parking/approval mechanics + audit (0080);
  event/bot source gating (0081).
- Token/dollar budgets, subscription quota throttling, kill switch — M12
  (0050/0075); the rate limiter only *coordinates* with them.
- `max_in_flight`, circuit breaker, backoff — system-load/failure policy (M19).

## Acceptance Criteria

- [ ] `per_actor_per_day` and `global_per_hour` caps are enforced from
      GitHub-derived counts (no DB); over-cap yields `defer` (default) or `park`.
- [ ] `schedule_window` (days/hours/tz, incl. midnight-wrap and DST) gates firing;
      out-of-window yields `defer` with `until` = next opening.
- [ ] Repo-default + per-loop override resolve **strictest-wins** (lower cap,
      intersected window).
- [ ] The cron system actor / sweep is exempt from per-actor caps but honors the
      window.
- [ ] When both 0082 and M12 apply, the runner takes the most-restrictive verdict
      and the latest `until`.
- [ ] A deferred trigger is reattempted by the sweep without double-counting.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add `rate_limit` + `schedule_window` to the `authorization` schema in
      `@looper/config` (zod), with repo-default ∪ per-loop strictest-wins merge.
- [ ] Implement the pure window evaluator (days/hours/tz, wrap, DST) in `core/gates`.
- [ ] Implement the GitHub-derived rate counter (per-actor/day, global/hour) over
      run-record/claim markers via `GitHubPort`.
- [ ] Return `WhenDecision` (allow | defer{until} | park) and wire it into the
      pre-flight pipeline in `@looper/runtime` after 0079/0081, before M12.
- [ ] Coordinate verdicts with M12 (most-restrictive + latest `until`).
- [ ] Ensure `defer` items are re-picked by the sweep (0076) idempotently.
- [ ] Update docs (`looper.yml` reference) for the two knobs.

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(`@looper/testing` fake GitHub from [0083](0083-fake-github.md)) — no real quota.

```bash
# replace with the chosen stack's runner (e.g. pnpm -w test --filter core --filter runtime)
# table-test: N dispatches in window vs per_actor_per_day / global_per_hour → defer at cap
# window: in/out/midnight-wrap/DST → allow vs defer(until=next opening)
# strictest-wins: per-loop tighter cap + narrower window override repo default
# system/sweep actor exempt from per-actor cap, still window-bound
# 0082 defer + M12 quota-throttle → most-restrictive verdict, latest until
# deferred item reattempted by sweep → no double-count (idempotency key)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the GitHub-derived counting source and rolling-window definition; the
`defer` vs `park` default for over-cap; the strictest-wins merge for caps/windows;
the system-actor exemption; and the verdict-coordination rule with M12.

## Risks / Rollback

The main risk is **miscounting** (a counting bug under-counts → quota drain, or
over-counts → wedged loop). Mitigate by counting effective dispatches from the
durable run-record/claim ledger (the same source the runner already writes),
defaulting to `defer` (recoverable) over `park`, and failing **closed** (treat an
unreadable count as at-cap → defer). Rollback: omitting both knobs (or setting
caps to `0`/unlimited and no window) disables the gate with zero behavior change;
it is purely additive to the pre-flight pipeline.

## Final Summary

Fill this in before marking verified.
