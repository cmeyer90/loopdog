# Milestone 19: Resilience & Failure Policy

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) "Resilience &
> failure policy." Generalizes the narrow stuck-detection in M12 · 0051 into a
> systematic, **user-tunable** failure model: partial failures, provider errors
> mid-dispatch, poisoned items, and load spikes degrade gracefully under the
> maintainer's control — not just "K failures → needs-human."

## Objective

Classify failures and expose **knobs** so maintainers control how loopdog degrades:
retries/timeouts, concurrency ceilings, circuit breakers on provider outages,
escalation routing, and quarantine for poisoned items — all configurable repo-wide
and per loop.

## Guiding Decisions

- A **failure taxonomy** drives the response: `transient` (retry w/ backoff),
  `terminal` (escalate), `poisoned` (item fails every attempt → quarantine),
  `overload` (too much in flight → defer), `budget` (out of quota → pause/park).
- This milestone owns **unintentional/system** resilience; intentional **abuse**
  controls (per-actor caps, untrusted actors) live in M17. Keep the boundary clean.
- **Circuit breaker** beats blind retries on a provider outage — open the circuit
  and pause the loop instead of burning attempts/quota.
- Nothing is silently dropped: an item that exhausts its policy lands in
  `needs-human`/`loopdog:quarantine` with the failure recorded in its run record.
- Knobs ship with safe defaults; every knob is overridable per loop.

Config (repo default in `loopdog.yml`, overridable per loop):

```yaml
resilience:
  retries: { max: 2, backoff: exponential, base: 30s, cap: 10m }
  dispatch_timeout: 30m              # no correlated PR by then → escalate (ties to 0073)
  max_attempts_per_item: 3           # then → needs-human + quarantine
  max_fix_attempts: 2                # review/fix sub-loop ceiling
  max_in_flight: { global: 10, per_loop: 4 }      # concurrency ceiling
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }   # pause on provider outage
  on_failure: needs-human            # needs-human | retry | abandon
  escalate_to: "@team/maintainers"   # who gets pinged on escalation
```

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0088 | verified | task/0088-failure-taxonomy | Failure Taxonomy & Classification | Pure total `classify`/`responseFor` (transient/terminal/poisoned/overload/budget → retry/escalate/quarantine/defer/pause). |
| 0089 | verified | task/0089-retry-timeout-backoff | Retry, Timeout & Backoff | 3-shape jittered backoff engine + runtime-stamped `dispatch_timeout` (lease-clamped, ingest-wins). |
| 0090 | verified | task/0090-concurrency-ceiling-and-circuit-breaker | Concurrency Ceiling & Circuit Breaker | `checkCeiling` + ledger-derived circuit breaker, enforced as pre-flight `skip` (defer/pause). |
| 0091 | verified | task/0091-resilience-knobs-and-quarantine | Resilience Knobs, Quarantine & Escalation | `resilience:` block honored + `loopdog:quarantine`/`on_failure`/`escalate_to` + `loopdog retry`/`status`. |

## Definition Of Done

- A documented failure taxonomy maps each class to a deterministic response.
- The `resilience:` knobs (retries/timeout/backoff/concurrency/circuit-breaker/
  escalation) are honored repo-wide and per loop, with safe defaults.
- A provider outage trips the circuit breaker (loop pauses) instead of burning
  retries; a load spike defers rather than overruns `max_in_flight`.
- A poisoned item is quarantined with its failure recorded, never silently dropped;
  escalations notify `escalate_to`.

## Verification Log

- 2026-06-12: M19 complete (0088–0091 verified). The failure taxonomy (pure,
  total) classifies every failed/pre-empted transition into one of five classes →
  one response, and the runtime honors the `resilience:` knobs end-to-end: a
  config-driven jittered backoff engine for `transient` retries, a runtime-stamped
  `dispatch_timeout` (lease-clamped, ingest-wins) that escalates a no-PR dispatch,
  a concurrency ceiling that defers a load spike, a ledger-derived circuit breaker
  that pauses a loop on a provider outage and admits a single half-open probe after
  cooldown, and quarantine + `on_failure`/`escalate_to` routing so a poisoned item
  is never silently dropped (released with `loopdog retry`; surfaced in `loopdog
  status`). Repo-wide: 242 tests across 33 files green (12 core + 4 e2e new for
  M19), lint + build clean, taxonomy table at `docs/resilience.md`. Honest
  deferrals (see task Decisions): the breaker's visible `loopdog:paused/<loop>`
  label + one-time comment and strict half-open single-flight are not applied
  (ledger-derived enforcement covers the semantics); the distinct per-dispatch
  `retry_count` budget is defined + tested in core but the runtime uses the item
  attempt counter for V1.
