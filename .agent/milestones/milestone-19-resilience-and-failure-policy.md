# Milestone 19: Resilience & Failure Policy

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) "Resilience &
> failure policy." Generalizes the narrow stuck-detection in M12 · 0051 into a
> systematic, **user-tunable** failure model: partial failures, provider errors
> mid-dispatch, poisoned items, and load spikes degrade gracefully under the
> maintainer's control — not just "K failures → needs-human."

## Objective

Classify failures and expose **knobs** so maintainers control how looper degrades:
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
  `needs-human`/`looper:quarantine` with the failure recorded in its run record.
- Knobs ship with safe defaults; every knob is overridable per loop.

Config (repo default in `looper.yml`, overridable per loop):

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
| 0088 | planned | task/0088-failure-taxonomy | Failure Taxonomy & Classification | Classify failures (transient/terminal/poisoned/overload/budget) → response mapping the runner uses. |
| 0089 | planned | task/0089-retry-timeout-backoff | Retry, Timeout & Backoff | Per-dispatch retries, `dispatch_timeout`, configurable backoff. |
| 0090 | planned | task/0090-concurrency-ceiling-and-circuit-breaker | Concurrency Ceiling & Circuit Breaker | `max_in_flight` + circuit breaker that pauses a loop on provider outage / load spikes. |
| 0091 | planned | task/0091-resilience-knobs-and-quarantine | Resilience Knobs, Quarantine & Escalation | The `resilience:` config block + `looper:quarantine` + `on_failure`/`escalate_to` routing + CLI visibility. |

## Definition Of Done

- A documented failure taxonomy maps each class to a deterministic response.
- The `resilience:` knobs (retries/timeout/backoff/concurrency/circuit-breaker/
  escalation) are honored repo-wide and per loop, with safe defaults.
- A provider outage trips the circuit breaker (loop pauses) instead of burning
  retries; a load spike defers rather than overruns `max_in_flight`.
- A poisoned item is quarantined with its failure recorded, never silently dropped;
  escalations notify `escalate_to`.

## Verification Log

Add dated entries as tasks land.
