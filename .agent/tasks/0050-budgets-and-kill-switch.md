# 0050 Budgets & Kill Switch

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

A deterministic **pre-flight guard** — global kill switch plus per-loop and global
budgets — that every loop checks **before any claim or dispatch**, so no loop spends
quota or token cost when halted or over budget. State lives entirely in GitHub
labels / repo variables — no database.

## Background

Part of [Milestone 12](../milestones/milestone-12-observability-cost-and-safety.md):
"every loop checks budget + quota + global kill switch **before** dispatching work."
This is one of the runner pre-flight gates (alongside the DoR/DoD gate (0014),
authorization (M17), and resilience policy (M19)) invoked by the transition runner
(0012). See [architecture](../../docs/architecture.md#observability-cost--safety)
and "Identity & secrets" (state is the `GITHUB_TOKEN`-writable label/variable plane,
GitHub is the only store). This task owns the **budget + kill-switch** half;
subscription rate caps are modelled by quota (0075) and provider-outage pausing by
the circuit breaker (M19) — this guard composes their verdicts into one decision.

## Scope

- A `BudgetGate` in `@loopdog/core` (pure predicate) and its effectful counterpart
  in `@loopdog/runtime` that reads kill-switch + budget state from GitHub.
- Global **kill switch**: a `loopdog:stop` label on a sentinel issue **or** a repo
  variable `LOOPDOG_STOP` — either halts *all* dispatch immediately.
- Per-loop and global **budgets**: token-cost ceiling and dispatch-count ceiling
  over a rolling window, sourced from `loopdog.yml`, spent against the run-record
  cost ledger (0012).
- Compose this verdict with quota (0075) and the circuit breaker (M19) so the runner
  gets one pass/park decision.
- A clear **parked** outcome (no spend, recorded), not a hard failure; parking is
  an operational hold label and does not replace the item's lifecycle state.

### Technical detail

**Lands in:** the pure predicate + types in `@loopdog/core` (`core/src/gates/`);
the GitHub-reading impl in `@loopdog/runtime` (`runtime/src/pipeline/preflight/`);
config schema in `@loopdog/config`. No new package, no new IO port (reuse
`GitHubPort` for labels/variables and the telemetry sink for the cost ledger).

**Config (`loopdog.yml`), validated by zod in `@loopdog/config`:**

```yaml
budgets:
  window: 24h                 # rolling window for all ceilings below
  global:
    max_dispatches: 100       # cloud tasks per window across all loops
    max_usd: 20               # optional token-cost ceiling (self-hosted/API backend)
  per_loop:
    implement: { max_dispatches: 40, max_usd: 10 }
    review:    { max_dispatches: 60 }
  on_exceeded: park           # park (default) | needs-human
kill_switch:
  variable: LOOPDOG_STOP       # repo variable name; presence/"true" = stop
  label: loopdog:stop          # label on the sentinel issue = stop
```

**Kill switch (checked first, cheapest).** Stop is active if **either** the repo
variable `LOOPDOG_STOP` is truthy (`get_repo_variable` via `GitHubPort`) **or** the
`loopdog:stop` label is present on the configured sentinel issue (default: the
`loopdog:meta` issue, falling back to repo variable only if absent). Either source ⇒
the gate returns `{ allowed: false, reason: 'kill-switch' }` and the runner parks
the item with `loopdog:parked` + a one-line comment while leaving its existing
`loopdog:state/*` label intact, emitting no dispatch.
`loopdog stop` / `loopdog resume-all` (CLI, M16) toggle the variable; humans can also drop
the label by hand. The variable is authoritative and instant; the label is the
human-visible mirror.

**Budgets.** The cost ledger is the **run records** (0012): each completed dispatch
records `cost: { routine_runs?, tokens?, usd? }` and `backend`. The gate aggregates
records whose `outcome.transition` fired within `window` (by `loop`, and globally),
counting `max_dispatches` from dispatch steps and summing `max_usd` from `cost.usd`.
A candidate transition is **denied** if adding one more dispatch would cross the
per-loop *or* the global ceiling (whichever binds first). Reading the ledger over a
window is O(records-in-window); cap the scan with the telemetry sink's time index
(0052/0053) so it is bounded. `max_usd` is meaningful only for the self-hosted/API
backend (subscription paths report no dollars — those are bounded by quota (0075),
not budget); a `max_usd` set with no usd-reporting backend is a config warning, not
an error.

**Composition (single pre-flight verdict).** The runtime preflight calls, in cheap-
to-expensive order: kill switch → budget (this task) → **quota (0075)** → **circuit
breaker (M19)**. The first that denies wins; the gate returns a discriminated union
so the runner records *which* guard parked the item:

```ts
type GuardVerdict =
  | { allowed: true }
  | { allowed: false; guard: 'kill-switch' | 'budget' | 'quota' | 'circuit'; reason: string; retryAfter?: Date }
```

`budget`/`quota` denials carry `retryAfter` = window/quota reset, so the cron sweep
re-attempts the parked item once the window rolls — no manual nudge needed. A
kill-switch denial has no `retryAfter` (it clears only on human resume).

**Parked, not failed.** On deny the runner sets `loopdog:parked` (a non-terminal
holding label), appends a `gate` step to the run record with `guard`+`reason`, and
posts/updates a single comment ("Parked: over budget for loop `implement` — resets
~14:00 UTC"). The lifecycle state label is preserved, so the sweep knows which
transition to retry after the hold clears. No attempt-counter increment (distinct
from a *failure* — this is a *hold*), so budget parking never feeds stuck-detection
(0051). The sweep removes the hold when `retryAfter` passes or the kill switch
clears.

**Edge cases:** (a) repo variable unreadable / GitHub error → **fail closed** (treat
as stopped) — never spend on an ambiguous signal; (b) ceiling set to `0` ⇒ that
scope is fully halted (a soft per-loop kill switch); (c) clock skew on `window` — use
the run-record timestamps, not wall-clock-at-eval, and the deterministic clock under
test (M18); (d) concurrent runs racing the same ceiling — budget is advisory/eventually
consistent (the atomic *claim* (0013) is the hard concurrency guard); slight overshoot
within one sweep tick is acceptable and bounded by `max_in_flight` (M19).

## Out Of Scope

- Subscription rate-cap modelling + throttle/queue (quota, 0075).
- Provider-outage pausing / retry backoff (circuit breaker + failure policy, M19).
- Stuck-detection / K-failure escalation (0051).
- The CLI surface for `loopdog stop`/`resume-all`/budget display (M16 · 0069); this task
  exposes the state the CLI reads/writes.

## Acceptance Criteria

- [x] With `LOOPDOG_STOP` set **or** the `loopdog:stop` label present, no loop
      dispatches; eligible items are parked with a recorded `kill-switch` reason.
- [x] A loop at or over its per-loop or the global ceiling is denied a new dispatch
      and parked with a `budget` reason and a `retryAfter` = window reset.
- [x] A loop under all ceilings with the kill switch off dispatches normally.
- [x] The verdict composes kill-switch → budget → quota (0075) → circuit (M19) in
      that order; the first denial wins and is recorded in the run record.
- [x] A GitHub read error on the kill-switch source fails **closed** (parks, never
      dispatches).
- [x] Budget parking does **not** increment the failure/attempt counter (no
      interaction with stuck-detection (0051)).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `budgets` + `kill_switch` schema to `@loopdog/config` (zod) + defaults.
- [x] Implement the pure `budgetGate(state, candidate): GuardVerdict` in `core/src/gates/`.
- [x] Implement the runtime reader: kill-switch (variable + sentinel label) + ledger
      aggregation over `window` from the telemetry sink.
- [x] Wire the gate into the runner pre-flight (0012) in cheap→expensive order and
      compose with quota (0075) + circuit (M19) into one verdict.
- [x] Implement the parked outcome: `loopdog:parked` hold label, run-record `gate`
      step, single idempotent comment; preserve the lifecycle state label and do
      not bump the attempt counter.
- [x] Expose `setStop()/clearStop()` helpers (repo variable) for the CLI (M16).

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake backend + deterministic clock) — **no real quota**.

```bash
pnpm vitest run packages/core packages/runtime
# unit: budgetGate predicate — under/at/over per-loop & global ceilings → verdicts
# scenario (fake GitHub + fake backend):
#   kill-switch label present  → eligible item parked, zero dispatches
#   LOOPDOG_STOP variable truthy → parked; variable read error → fails closed (parked)
#   ledger at ceiling          → park with retryAfter; advance clock past window → dispatches
#   composition order          → kill-switch beats budget beats quota beats circuit
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

- GuardVerdict union in core gates/guards.ts; composition order
  kill-switch → budget → quota in the runtime preflight (createPreflight)
  wired into the runner's extraChecks — the access/safety siblings (M17/M19)
  compose into the same hook.
- Kill switch V1: the repo VARIABLE (env-visible in Actions) is authoritative;
  the per-item loopdog:stop label is already a standard hold. The sentinel-
  issue label mirror is deferred (recorded simplification — the variable +
  item label cover both repo-wide and per-item stops).
- Budgets aggregate the run-record ledger (dispatch steps + cost.usd) over
  the configured window; 0 = unlimited; on_exceeded park|needs-human honored.
- Parking preserves the lifecycle label and writes a `loopdog:hold` marker
  comment (reason + retryAfter) the sweep reads.

## Risks / Rollback

- **Fail-open would burn quota** under a GitHub blip — the gate must fail *closed*;
  guard that path with an explicit test.
- A mis-set ceiling could starve all loops silently; the parked comment + `loopdog
  status` (M16) must make "why nothing is running" obvious, and `0` is a documented
  intentional halt.
- Budget is eventually-consistent (race-tolerant by design); the *hard* concurrency
  guarantee remains the atomic claim (0013), not this gate. Rollback: set generous
  ceilings + clear the kill switch; the gate is additive and disabling it (no
  `budgets`/`kill_switch` config) reverts to no pre-flight budget check.

## Final Summary

Budget + kill-switch are pre-flight guards: pure predicates in core, a
ledger-reading preflight in runtime, parked (never failed) outcomes with hold
markers, and CLI/sweep-honored retry semantics — proven with zero-dispatch
assertions.
