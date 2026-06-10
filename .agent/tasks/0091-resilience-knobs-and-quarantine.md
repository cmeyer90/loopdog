# 0091 Resilience Knobs, Quarantine & Escalation

Status: planned  
Branch: task/0091-resilience-knobs-and-quarantine

## Goal

Expose the `resilience:` config block — the knobs maintainers tune to control how
looper degrades — and the terminal behaviors they drive: quarantine for poisoned
items and escalation routing, never a silent drop.

## Background

Part of [Milestone 19](../milestones/milestone-19-resilience-and-failure-policy.md).
Consumes the failure taxonomy (0088) and the retry/circuit mechanisms (0089/0090);
this task is the **user-facing surface** — the config knobs + quarantine/escalation.
See [architecture](../../docs/architecture.md#resilience--failure-policy).

## Scope

- The `resilience:` config block (root default + per-loop override), validated by
  M02 · 0006.
- `looper:quarantine` for items that exhaust `max_attempts_per_item`, with the
  failure recorded in the run record.
- `on_failure` routing (`needs-human` | `retry` | `abandon`) and `escalate_to`
  notification.
- CLI visibility: quarantined/escalated items in `looper status`; a release path.

### Technical detail

Knobs (defaults shown; every one overridable per loop):

```yaml
resilience:
  retries: { max: 2, backoff: exponential, base: 30s, cap: 10m }   # transient (0089)
  dispatch_timeout: 30m                                            # no PR by then → escalate
  max_attempts_per_item: 3        # exhausted → looper:quarantine + on_failure
  max_fix_attempts: 2             # review/fix sub-loop ceiling
  max_in_flight: { global: 10, per_loop: 4 }                      # overload (0090)
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }      # provider outage (0090)
  on_failure: needs-human         # needs-human | retry | abandon
  escalate_to: "@team/maintainers"
```

- **Quarantine** is a terminal hold: the item gets `looper:quarantine`, its run
  record captures the failure class + last error, and it leaves the active pipeline
  until a human clears it (`looper retry <item>` re-queues; clearing is audited).
- **Escalation** assigns/pings `escalate_to` and comments the reason.
- The CLI surfaces `looper status` counts (quarantined/escalated/paused) and a
  `looper retry`/`looper resume` path; ties into M16.

## Out Of Scope

- The taxonomy itself (0088); retry/timeout mechanics (0089); circuit-breaker/
  concurrency engine (0090).

## Acceptance Criteria

- [ ] The `resilience:` block (root + per-loop) is validated and honored with safe
      defaults.
- [ ] An item exhausting `max_attempts_per_item` is quarantined with its failure
      recorded — never silently dropped — and is human-releasable (`looper retry`).
- [ ] `on_failure` routing and `escalate_to` notification work.
- [ ] `looper status` surfaces quarantined/escalated/paused items.

## Implementation Checklist

- [ ] Define + validate the `resilience:` schema (with M02 · 0006).
- [ ] Implement quarantine (label + run-record capture + human release).
- [ ] Implement `on_failure`/`escalate_to` routing + notification.
- [ ] Surface state in the CLI (`status`, `retry`, `resume`).

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# exhaust attempts → quarantined + recorded; looper retry → re-queued; escalate pings
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the knob defaults, the quarantine record shape, and the release/audit flow.

## Risks / Rollback

Silent drops are the failure to avoid — default every terminal path to a visible,
recorded, human-releasable state, not deletion.

## Final Summary

Fill this in before marking verified.
