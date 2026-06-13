# 0091 Resilience Knobs, Quarantine & Escalation

Status: verified  
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

- [x] The `resilience:` block (root + per-loop) is validated and honored with safe
      defaults.
- [x] An item exhausting `max_attempts_per_item` is quarantined with its failure
      recorded — never silently dropped — and is human-releasable (`looper retry`).
- [x] `on_failure` routing and `escalate_to` notification work.
- [x] `looper status` surfaces quarantined / escalated / approval-held items under
      ATTENTION. (A loop-level "paused" indicator is N/A — the breaker is enforced
      from the ledger, not a label; see 0090 Decisions.)

## Implementation Checklist

- [x] Define + validate the `resilience:` schema (`resilienceSchema` in
      `@looper/config`, root + per-loop `.partial()`; backoff enum extended to the
      three 0089 shapes) → resolved to `LoopDefinition['resilience']` + normalized
      to ms policy types by the core `resilience/normalize.ts`.
- [x] Implement quarantine (`looper:quarantine` + `looper:needs-human` label,
      run-record `escalated`/`poisoned` capture, human release via `looper retry`).
- [x] Implement `on_failure` routing (needs-human → quarantine, abandon →
      `looper:abandoned`, retry → keep backing off) + `escalate_to` ping in the
      quarantine/timeout comments.
- [x] Surface state in the CLI: `status` ATTENTION list + a new `looper retry`
      (clears quarantine/needs-human/attempt/backoff labels). (`resume` already
      exists for paused loops.)

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# exhaust attempts → quarantined + recorded; looper retry → re-queued; escalate pings
```

## Verification Log

- 2026-06-12: quarantine + escalation e2e green (`resilience-e2e.test.ts`): with
  `max_attempts_per_item: 2` + `escalate_to: "@team/oncall"` + a `fail-dispatch`
  backend, the 2nd failed attempt adds `looper:quarantine` + `looper:needs-human`,
  posts a comment pinging `@team/oncall` + mentioning `looper retry`, and writes an
  `escalated`/`poisoned` run record — nothing silently dropped. The `resilience:`
  block validates with safe defaults and per-loop overrides (existing config tests
  + the e2e scaffold edits). `looper status` ATTENTION includes `looper:quarantine`
  + `looper:needs-approval`. Full suite (242) green.

## Decisions

- The `resilience:` schema (durations as `30s`/`10m`/`1h` strings, backoff ∈
  {exponential, linear, constant}) lives in `@looper/config` and was scaffolded by
  an earlier milestone; this task extended the backoff enum (0089) and consumes the
  resolved block. The core `resilience/normalize.ts` converts it to the ms policy
  types the runtime reads. Defaults: retries max 2 / exp / 30s / 10m, dispatch_
  timeout 30m, max_attempts_per_item 3, max_fix_attempts 2, max_in_flight
  {10, 4}, circuit_breaker {5, 1h}, on_failure needs-human.
- Quarantine capture: the poisoned item gets `looper:quarantine` + `looper:needs-
  human`, a comment (with the `escalate_to` ping + the `looper retry` hint), and an
  `escalated` run record carrying `failure: { class: 'poisoned', reason }` — the
  audit trail. `on_failure` routes the poisoned case: `needs-human` (default) →
  quarantine; `abandon` → `looper:abandoned` off-ramp; `retry` → keep backing off
  (no quarantine). The same routing applies on a dispatch-timeout poisoning (0089).
- Release/audit: `looper retry <item>` removes `looper:quarantine` + `looper:needs-
  human` + the `looper:attempts/*` + `looper:not-before/*` labels and posts an
  auditable "released by <who>" comment, so the sweep re-attempts cleanly. (Like
  `looper approve`, it acts over the real `GitHubPort` — covered by the runtime
  quarantine e2e rather than a CLI-over-mock unit test.)

## Risks / Rollback

Silent drops are the failure to avoid — default every terminal path to a visible,
recorded, human-releasable state, not deletion.

## Final Summary

The `resilience:` knobs are validated + honored (repo-wide + per-loop, safe
defaults) and drive the terminal behaviors: a poisoned item is quarantined
(`looper:quarantine` + `needs-human`) with its failure recorded and an
`escalate_to` ping — never silently dropped — and is human-releasable with
`looper retry`. `on_failure` routes needs-human/abandon/retry; `looper status`
surfaces the holds. Proven end-to-end on the fakes.
