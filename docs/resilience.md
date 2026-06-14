# Resilience & Failure Policy

Loopdog degrades **under the maintainer's control**. Every failed or pre-empted
transition is classified into one of five failure classes, each mapping to one
deterministic response. The knobs that tune the responses live in a
`resilience:` block in `loopdog.yml` (repo-wide) and may be overridden per loop.

> Implemented across M19 (tasks 0088–0091): the pure taxonomy + retry/backoff +
> ceiling + breaker live in `@loopdog/core/src/resilience/`; the runtime wires
> them into the transition runner and pre-flight.

## The failure taxonomy

The classifier (`classify`) reads a typed `FailureSignal` in a fixed precedence
(first match wins) and is total — no `default`, every input lands in exactly one
class. `responseFor` maps each class to exactly one response.

| Class | Trigger (precedence ↓) | Response | Burns an attempt? |
|---|---|---|---|
| `budget` | a spend gate (budget/quota) denied | **pause** — park, never spend; the sweep retries when the window resets | no |
| `overload` | the concurrency ceiling (`max_in_flight`) is already met | **defer** — leave the item untouched; the sweep retries when headroom frees | no |
| `terminal` | an *unrecoverable* provider/protocol error | **escalate** — route to `loopdog:needs-human` | yes |
| `poisoned` | the item has failed every attempt (`attempts ≥ max_attempts_per_item`) | **quarantine** — `loopdog:quarantine` + `needs-human`, failure recorded, `escalate_to` pinged; human-releasable with `loopdog retry` | yes |
| `transient` | anything else — including an absent/recoverable error with attempts remaining (**fail-open**) | **retry** — back off (`resilience.retries`) and re-arm via the sweep | yes |

**Why fail-open?** An unknown error with attempts left is treated as `transient`
(retry), never `terminal` — a misclassified blip should cost a retry, not a
false escalation. Only an explicitly *unrecoverable* error is `terminal`.

**Attempt-increment contract.** `retry`/`escalate`/`quarantine` follow a real
failure, so they increment the item attempt counter (`loopdog:attempts/N`).
`defer` (overload) and `pause` (budget) are *not the item's fault* — they consume
no attempt, so the item is re-tried cleanly once headroom/budget returns.

## The `resilience:` knobs

```yaml
resilience:
  retries: { max: 2, backoff: exponential, base: 30s, cap: 10m }   # transient backoff
  dispatch_timeout: 30m              # no correlated PR by then → timed-out (transient) attempt
  max_attempts_per_item: 3           # then → quarantine
  max_fix_attempts: 2                # review/fix sub-loop ceiling
  max_in_flight: { global: 10, per_loop: 4 }                       # concurrency ceiling → defer
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }       # provider outage → pause loop
  on_failure: needs-human            # needs-human | retry | abandon
  escalate_to: "@team/maintainers"   # pinged on quarantine/escalation
```

Every knob has a safe default and is overridable per loop; per-loop overrides
are **strictest-wins** on the safety caps (a loop may only be made *safer*).

### Backoff shapes

`backoff` is one of `exponential` (`base·2^(n-1)`), `linear` (`base·n`), or
`constant` (`base`), each capped at `cap` and applied with **full jitter** (a
uniform draw in `[0, ceiling]`) so retries don't thundering-herd. Re-attempts are
always **sweep-driven** — loopdog never busy-waits in process.

### Circuit breaker

After `consecutive_failures` **provider** failures on a `(loop, backend)` the
circuit **opens**: that loop stops dispatching for `cooldown`. After the cooldown
it goes **half-open** and admits a single probe; the probe's success **closes**
it, its failure **re-opens** it for another cooldown. Breaker state is derived
from the run-record ledger (the same no-side-DB pattern as the budget/quota
gates) — a **content** failure (CI red, review reject) never trips it; only
provider/dispatch failures do.

### Dispatch timeout

A dispatch with no correlated PR (0073) by `dispatch_timeout` is detected by the
sweep, the claim released, and recorded as a timed-out (`transient`) attempt —
not stranded, not double-dispatched. Ingest **wins** over the timeout (a PR that
arrives first ingests normally and clears the deadline), and the deadline is
clamped to never outlive the claim lease.

## Operating it

- `loopdog status` surfaces quarantined / escalated / approval-held items under
  **ATTENTION**.
- `loopdog retry <item>` releases a quarantined item: it clears `loopdog:quarantine`
  + `loopdog:needs-human` + the attempt/backoff counters so the sweep re-attempts
  cleanly (do it once the underlying cause is fixed).
- Nothing is ever silently dropped — a poisoned item always lands in quarantine
  with its failure recorded in the run record.
