# 0075 Subscription Quota & Rate-Limit Management

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Model each provider's **subscription rate caps** (Codex cloud ~5 tasks/hr on lower
tiers; Claude routine daily caps) as a deterministic pre-flight **quota gate**, and
**throttle/queue** dispatch to stay inside them — so a loop that would exceed a cap
**defers** (parked, re-attempted by the sweep when the window rolls) instead of
firing a dispatch the provider will reject. State lives in the run-record ledger and
GitHub labels — no database, no provider quota API call.

## Background

Part of [Milestone 12](../milestones/milestone-12-observability-cost-and-safety.md):
"Budgeting models **subscription quota** (Codex ~5 cloud tasks/hr lower tiers; Claude
routine daily caps), not only dollars — throttle/queue dispatch to fit." This is one
of the runner pre-flight gates (alongside DoR/DoD (M03 · 0014), authorization (M17),
budget/kill-switch (0050), and resilience policy (M19)) invoked by the transition
runner (0012). See [architecture](../../docs/architecture.md#observability-cost--safety)
and "The honest constraints" — **subscription rate limits, not just dollars**.

The sibling task 0050 owns the kill switch + token/dispatch **budgets** and defines
the shared `GuardVerdict` discriminated union and the cheap→expensive composition
order (kill-switch → budget → **quota (this task)** → circuit (M19)). This task fills
the `quota` arm of that union. The quota window is provider-defined and per-backend,
so the cap data comes from the **backend capability descriptor** in `@loopdog/backends`
(M05), not from `loopdog.yml` defaults alone. Outage pausing stays in the circuit
breaker (M19); this gate only handles *staying under a healthy provider's cap*.

## Scope

- A pure `quotaGate(state, candidate): GuardVerdict` in `@loopdog/core` and its
  effectful counterpart in `@loopdog/runtime` preflight.
- A **per-backend quota model**: window length + max dispatches per window, defaulted
  from the backend capability descriptor (M05) and overridable in `loopdog.yml`.
- **Throttle/queue, not fail**: a candidate that would exceed the cap is parked
  with the operational hold label `loopdog:parked`, `guard: 'quota'`, and a
  `retryAfter` = next window slot. Its existing `loopdog:state/*` label stays in
  place, so the sweep (0076) re-attempts the same transition — dispatch is
  *deferred*, never *failed*.
- Counting from the **run-record ledger** (0012): dispatch events per backend within
  the rolling/calendar window, including in-flight (correlated-but-unmerged) runs.
- Compose into the shared verdict (0050) so the runner gets one pass/park decision.

### Technical detail

**Lands in:** pure predicate + types in `@loopdog/core` (`core/src/gates/`); the
ledger-reading impl in `@loopdog/runtime` (`runtime/src/pipeline/preflight/`); cap
defaults on the backend descriptor in `@loopdog/backends`; `quota` config schema in
`@loopdog/config`. **No new package, no new IO port, no provider quota API call** —
quota is *estimated locally* from loopdog's own dispatch ledger, because neither
provider exposes a reliable remaining-quota endpoint on the subscription path.

**Backend capability descriptor (M05 · 0019), extended:**

```ts
interface BackendCapabilities {
  // ...existing dispatch/ingest capability flags...
  quota?: {
    window: '1h' | '24h' | string;   // provider window; rolling unless `calendar`
    max_dispatches: number;          // cloud tasks per window for this subscription tier
    kind: 'rolling' | 'calendar';    // codex ~5/hr = rolling; claude daily = calendar (UTC)
  };
}
```

Defaults shipped with the backends: `codex → { window: '1h', max_dispatches: 5, kind:
'rolling' }`; `claude → { window: '24h', max_dispatches: <tier-default>, kind:
'calendar' }`; `self-hosted → undefined` (no provider cap; bounded only by budget
(0050) + `max_in_flight` (M19)).

**Config override (`loopdog.yml`), validated by zod in `@loopdog/config`:**

```yaml
quota:
  backends:
    codex:  { window: 1h,  max_dispatches: 5 }    # raise on higher tiers
    claude: { window: 24h, max_dispatches: 50, reset: calendar }
  on_exceeded: defer            # defer (default) — sweep re-attempts at retryAfter
```

The effective cap is `loopdog.yml` override ∪ backend descriptor default (override
wins; if neither present and `self-hosted`, quota is unbounded → `{ allowed: true }`).

**Counting (the ledger is the only source).** The gate counts dispatch steps in the
**run records** (0012) whose `backend` == the candidate's backend and whose dispatch
timestamp falls within the window. For `kind: 'rolling'` the window is `[now - window,
now)`; for `kind: 'calendar'` it is the current UTC calendar day/hour boundary. A
candidate is **denied** if `count + 1 > max_dispatches`. In-flight dispatches (run
records with a dispatch step but no terminal `merged`/`failed` outcome — i.e. a
correlated PR still open, per 0073) **count against quota**, because the provider has
already consumed the slot; this prevents a burst of parallel claims from overrunning
the cap within a single sweep tick. Scan is bounded by the telemetry sink's time
index (0052/0053), same as the budget ledger (0050).

**`retryAfter` (drives the throttle/queue behaviour).** On deny, compute the earliest
moment the cap admits one more dispatch:
- `rolling`: `retryAfter = oldest-dispatch-in-window.timestamp + window` (the slot
  frees when the oldest run ages out).
- `calendar`: `retryAfter = next window boundary` (next UTC day/hour).

The verdict carries `retryAfter`; the runner parks the item with `loopdog:parked`
and the sweep (0076) re-evaluates it at/after `retryAfter` using the still-present
lifecycle state label — this *is* the queue. No in-memory queue, no timer: the
parked hold + `retryAfter` + sweep is the durable, crash-safe throttle. Items
naturally drain in claim order as slots free.

**Verdict + composition.** Reuse the `GuardVerdict` union from 0050:

```ts
quotaGate(state: QuotaState, candidate: Candidate): GuardVerdict
// -> { allowed: true }
//  | { allowed: false; guard: 'quota'; reason: string; retryAfter: Date }
```

`reason` is operator-readable, e.g. `"quota: codex at 5/5 dispatches this hour — next
slot ~14:37 UTC"`. The runtime preflight calls `quotaGate` **after** kill-switch +
budget (0050) and **before** the circuit breaker (M19); first denial wins. Like a
budget park, a quota park is a **hold, not a failure**: no attempt-counter increment,
so quota deferral never feeds stuck-detection (0051).

**Edge cases:** (a) backend with no quota descriptor and no override (self-hosted) →
always `allowed` (bounded elsewhere). (b) Clock skew / DST on `calendar` windows — all
boundaries computed in UTC from run-record timestamps, deterministic clock under test
(M18). (c) A dispatch that the provider *rejects* for quota despite the local estimate
(our count drifted low, e.g. quota shared with the human's interactive use) → the
ingest/timeout path (0073) records it `failed`; M19 backoff re-attempts; we do **not**
hard-fail the item. (d) Multiple loops sharing one backend share **one** per-backend
counter (quota is the subscription's, not the loop's) — keyed by `backend`, never by
`loop`. (e) Ledger empty / first run → count 0 → `allowed`. (f) Estimate is advisory
and eventually-consistent (like budget); the **atomic claim (0013)** remains the hard
concurrency guard, and `max_in_flight` (M19) bounds worst-case overshoot within a tick.

## Out Of Scope

- Kill switch + token/dollar budgets + the `GuardVerdict` type and composition harness
  (0050 — this task plugs into them).
- Provider-outage pausing / circuit breaker / failure-classification backoff (M19).
- Stuck-detection / K-failure escalation (0051).
- Any provider quota **API** call or scraping a remaining-quota endpoint (none exists
  on the subscription path; we estimate from our own ledger).
- The CLI surface that displays quota/headroom (M16 · 0069); this task produces the
  state the CLI reads.

## Acceptance Criteria

- [x] A backend at its window cap is denied a new dispatch and the item is parked with
      `guard: 'quota'`, a human-readable `reason`, and a `retryAfter`.
- [x] A backend under its cap dispatches normally; counting includes in-flight
      (correlated-but-open) dispatches, not just merged ones.
- [x] `rolling` windows (Codex 5/hr) and `calendar` windows (Claude daily, UTC) each
      compute `retryAfter` correctly (oldest-ages-out vs. next boundary).
- [x] The cron sweep (0076) re-attempts a quota-parked item at/after `retryAfter`
      with no manual nudge; items drain in claim order.
- [x] Cap is per **backend** (shared across loops), defaulted from the backend
      descriptor and overridable in `loopdog.yml`; self-hosted with no cap is unbounded.
- [x] Quota deferral does **not** increment the failure/attempt counter (no
      interaction with stuck-detection (0051)).
- [x] The verdict composes after budget (0050) and before circuit (M19); first denial
      wins and is recorded in the run record `gate` step.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `quota` block to the backend capability descriptor (M05 · 0019) with
      `codex`/`claude`/`self-hosted` defaults.
- [x] Add the `quota` schema + overrides to `@loopdog/config` (zod) and merge logic
      (override ∪ descriptor default).
- [x] Implement the pure `quotaGate(state, candidate): GuardVerdict` in
      `core/src/gates/` (rolling + calendar window math, `retryAfter`).
- [x] Implement the runtime reader: per-backend ledger aggregation (incl. in-flight)
      over the window from the telemetry sink (0052/0053).
- [x] Wire `quotaGate` into the preflight composition (0050) after budget, before
      circuit (M19); park with `loopdog:parked` + `retryAfter`, preserve the
      lifecycle state label, and do not bump attempts.
- [x] Ensure the sweep (0076) un-parks quota holds at `retryAfter`.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake backend + deterministic clock) — **no real quota**.

```bash
pnpm vitest run packages/core packages/runtime
# unit: quotaGate predicate
#   under cap → allowed; at cap → denied (rolling) with retryAfter = oldest + window
#   calendar window → denied with retryAfter = next UTC boundary
#   in-flight dispatch counts toward the cap; self-hosted (no descriptor) → allowed
# scenario (fake GitHub + fake backend + deterministic clock):
#   dispatch N=cap items → next is parked (quota), zero extra dispatches
#   advance clock past retryAfter → sweep (0076) re-attempts and dispatches
#   composition: budget passes, quota denies → recorded guard='quota'; no attempt bump
#   two loops on one backend share the counter → second loop also throttled
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

- Quota is estimated LOCALLY from loopdog's own dispatch ledger (no provider
  quota API exists on the subscription path); per-backend models come from
  capability descriptors (codex 5/hr rolling) with config overrides
  (quota.backends.<id>.{window,max_dispatches}); claude daily caps are
  config-declared (calendar UTC window).
- Exhaustion defers: loopdog:parked + retryAfter = the next window slot
  (rolling: now+window; calendar: next UTC midnight); the sweep unparks once
  it passes and the transition re-evaluates through pre-flight.

## Risks / Rollback

- **Local estimate can drift** from the provider's true remaining quota (shared with
  the human's interactive sessions, tier changes, beta-API limit changes). Mitigation:
  treat the gate as a *throttle* and let a provider-side rejection fall through to M19
  backoff (graceful), rather than trusting the estimate as authoritative — guard with
  the edge-(c) test. Conservative default caps (Codex 5/hr) bias toward under-spending.
- Over-counting in-flight runs could *under*-utilise quota (leave slots idle); this is
  the safe direction. Operators raise `max_dispatches` per their real tier via config.
- Quota is eventually-consistent and race-tolerant by design; the hard concurrency
  guarantee remains the atomic claim (0013) + `max_in_flight` (M19), not this gate.
- Rollback: the gate is additive — omit the `quota` config and ship backends without
  a `quota` descriptor and every candidate is `allowed` (no quota throttling), leaving
  only budget (0050) + circuit (M19) in the preflight.

## Final Summary

Subscription quota is modeled per backend from the run-record ledger and
enforced as throttle/queue-never-fail: candidates over the cap park with the
next-window retryAfter and the sweep re-attempts the same transition.
