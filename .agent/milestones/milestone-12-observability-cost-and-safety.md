# Milestone 12: Observability, Cost & Safety

Status: verified

> Background: [Looper Architecture](../../docs/architecture.md) —
> "Observability, cost & safety" and the subscription rate-limit constraints.
> Cross-cutting; layers across the loops once Milestones 08–10 exist. The CLI
> surface over this data is Milestone 16.

## Objective

Make the loops observable, bounded, and safe to leave running: budgets that model
**both token cost and subscription rate caps**, a kill switch checked before any
dispatch, stuck detection with backoff and escalation, run reporting that needs no
hosted UI, and per-provider outcome telemetry that feeds routing.

## Guiding Decisions

- Every loop checks budget + quota + global kill switch (label or repo variable)
  **before** dispatching work.
- Budgeting models **subscription quota** (Codex ~5 cloud tasks/hr lower tiers;
  Claude routine daily caps), not only dollars — throttle/queue dispatch to fit.
- After K failed attempts on one issue → `needs-human`, with exponential-backoff
  re-attempts driven by the cron reconcile sweep (M02). This basic stuck-detection
  is generalized into the full, tunable failure policy in M19.
- Reporting works with zero infra: Actions job summaries + issue/PR comments + the
  CLI (M16); an optional dashboard is additive. Telemetry is per-loop and
  per-provider so routing (M13) is data-driven.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0050 | verified | task/0050-budgets-and-kill-switch | Budgets & Kill Switch | Pre-flight budget/kill-switch check every loop honors. |
| 0075 | verified | task/0075-subscription-quota-management | Subscription Quota & Rate-Limit Management | Model provider rate caps; throttle/queue dispatch to stay within quota. |
| 0051 | verified | task/0051-stuck-detection-and-escalation | Stuck Detection & Escalation | K-failure → `needs-human` with exponential backoff. |
| 0052 | verified | task/0052-run-reporting | Run Reporting | Job-summary + comment reporting of runs, transitions, and cost/quota. |
| 0053 | verified | task/0053-per-provider-outcome-telemetry | Per-Provider Outcome Telemetry | Logged outcomes per loop and per provider for routing + the CLI. |

## Definition Of Done

- [x] No loop dispatches when over budget, over quota, or when the kill switch
  is set (preflight composed into the runner; zero-dispatch assertions).
- [x] Provider rate limits are respected; dispatch is throttled/queued (parked
  with next-window retryAfter the sweep honors), never failed.
- [x] Repeatedly failing items escalate with exponential backoff (not-before
  timers) at the attempt ceiling, never retried forever.
- [x] Each run reports transitions/cost/quota with zero hosted infra (job
  summaries, idempotent comments, the NDJSON ledger + aggregates the CLI and
  routing consume).

## Verification Log
- 2026-06-09: all tasks verified; 180 tests green repo-wide (guards, behavioral
  parks with retryAfter holds, telemetry aggregation, routing, review pairing,
  and the three-tick tier:core ensemble on fakes).
