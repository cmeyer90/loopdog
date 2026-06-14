# 0051 Stuck Detection & Escalation

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Stop loops from retrying a doomed item forever: after K failed attempts on one
issue, escalate it to `loopdog:needs-human` with its failure recorded, and drive
exponential-backoff re-attempts in between off the cron reconcile sweep — never a
busy retry inside one invocation.

## Background

Part of [Milestone 12](../milestones/milestone-12-observability-cost-and-safety.md)
— "stuck detection with backoff and escalation" and the Guiding Decision *"After
K failed attempts on one issue → `needs-human`, with exponential-backoff
re-attempts driven by the cron reconcile sweep."* See
[architecture](../../docs/architecture.md) "Observability, cost & safety" and
"Resilience & failure policy."

This is the **basic** stuck-detection primitive. It is deliberately the smallest
correct mechanism — an attempt counter, a backoff clock, and one escalation
edge. The full classified, user-tunable failure policy (taxonomy, circuit
breaker, `max_in_flight`, quarantine) is M19 and is **out of scope here**; this
task's data structures (attempt count, next-attempt time, last-failure record)
must be shaped so M19 generalizes them without a rewrite. The transition runner
(0012) hands failures here; the sweep (0076) drives the backoff/escalation timers;
the gate stack (0014/M17/0050) is upstream and unaffected.

## Scope

- A per-item **attempt counter** and **last-failure record**, persisted in GitHub
  state (the durable substrate — no DB), incremented when the runner reports a
  failed transition.
- A **backoff schedule**: a failed attempt sets a `not-before` timestamp; the item
  is ineligible for re-dispatch until the sweep's clock passes it. Exponential
  with a cap.
- An **escalation edge**: when attempts reach `max_attempts`, move the item to the
  `loopdog:needs-human` off-ramp, post a summary comment, and stop re-attempting.
- A **human-releasable reset** so a maintainer can clear the counter and re-arm the
  item (the hook `loopdog retry` / approval will call; CLI surface is M16).

### Technical detail

**Lands in `@loopdog/core`** (pure decision logic: `core/src/resilience/` — the
backoff/escalation predicate + types) **and `@loopdog/runtime`** (the effectful
side: read/write the markers via the `GitHubPort`, post the comment, set the
label; called from the transition pipeline and the sweep). No new IO port — it
rides the existing `GitHubPort`.

**Where the state lives (GitHub is the store).** Per item, two pieces of durable
state, written by the runtime, read by the pure predicate:

1. **Attempt counter + backoff clock** — a single hidden marker block in the issue
   body (parseable, survives re-labeling, visible to humans):

   ```
   <!-- loopdog:attempts loop=implement count=2 not_before=2026-06-08T14:32:00Z
        first_failed=2026-06-08T13:10:00Z last_run=run_91c last_class=failed -->
   ```

   Keyed by `loop` so two loops failing on the same item track independently.
2. **The failure detail** — the failing **run record** (0012) is the source of
   truth for *why*; the marker only holds the count + clock + a pointer
   (`last_run`) into telemetry (0053). The escalation comment quotes the last
   failure's `outcome` + a link to its `gh_run`.

**Pure predicate** in `core` (IO-free, unit-tested):

```ts
type AttemptState = { count: number; notBefore?: Date; firstFailed?: Date };
type Policy = { maxAttempts: number; base: Seconds; cap: Seconds }; // from config
type Decision =
  | { kind: 'eligible' }                       // clock passed, attempts remain
  | { kind: 'backoff'; until: Date }           // wait — not-before in the future
  | { kind: 'escalate' };                      // attempts exhausted → needs-human

function evaluate(s: AttemptState, p: Policy, now: Date): Decision;
function nextBackoff(count: number, p: Policy): Seconds; // base * 2^(count-1), capped
function recordFailure(s: AttemptState, p: Policy, now: Date): AttemptState; // ++count, set notBefore
```

**Backoff** is exponential with jitter on top of `base`, capped at `cap`
(reuse the `resilience.retries` shape from architecture: `base: 30s, cap: 10m`;
add full jitter `random(0, computed)` to avoid sweep-synchronized thundering
herds). `max_attempts` defaults to **3** (matching `max_attempts_per_item` in the
architecture's resilience block).

**Two integration points:**

- **Runner (0012), on a failed step** — call `recordFailure` → write the marker.
  If the resulting decision is `escalate`, set label `loopdog:needs-human`, drop the
  in-flight claim (0013), post the escalation comment, and emit a run record with
  `outcome.status: escalated`. Otherwise leave the item in its state with the
  backoff clock set (it stays out of the eligible set until the clock passes).
- **Sweep (0076), per tick** — when selecting eligible items, the runner consults
  `evaluate`: an item whose `not_before` is still in the future is **skipped this
  tick** (it is the sweep's clock that later makes it eligible — this is the
  "time-based transition" the sweep owns). No model spend while backing off.

**Config keys** (repo-wide in `loopdog.yml`, per-loop override in `loop.yml`; the
strictest wins, consistent with other gates):

```yaml
resilience:                 # subset of the full M19 block; forward-compatible
  max_attempts_per_item: 3
  backoff: { base: 30s, cap: 10m }
  on_failure: needs-human   # V1: only needs-human is honored here
  escalate_to: "@team/maintainers"   # @-mentioned in the escalation comment
```

**Reset / release.** Clearing the marker (count→0, drop `not_before`) re-arms the
item. The runner exposes a `resetAttempts(item, loop)` op the M16 `loopdog retry`
command and the approval path call; manually removing `loopdog:needs-human`
without a reset must also clear the counter (the runner reconciles on the next
sweep so a hand-edit doesn't immediately re-escalate).

**Edge cases:** (a) a *successful* transition clears the marker — a flaky item
that eventually passes doesn't carry stale failures; (b) marker absent/malformed →
treat as `count: 0` (fail-open to *eligible*, but log a warning so corruption is
visible — never silently escalate on a parse miss); (c) the dispatch-timeout /
no-result path (0073) reports its escalation **through this same counter**, so a
provider that opens no PR counts as a failed attempt, not a separate code path;
(d) escalation is idempotent — re-running it on an already-`needs-human` item is a
no-op (guard on the label).

## Out Of Scope

- The full classified failure taxonomy, circuit breaker, `max_in_flight`/defer,
  and `loopdog:quarantine` (M19).
- The CLI surface (`loopdog retry`, status views) — M16.
- Telemetry storage/format (0053); run-record schema itself (0012).
- Budget/quota/kill-switch pre-flight (0050/0075) — a separate gate; "out of
  budget" is *not* a failed attempt and must not increment the counter.

## Acceptance Criteria

- [x] A failed transition increments a per-(item, loop) attempt counter persisted
      in GitHub state (issue-body marker), not in memory.
- [x] After a failure, the item is ineligible for re-dispatch until its
      exponential-backoff `not_before` passes; the sweep, not a busy loop, re-arms
      it.
- [x] On reaching `max_attempts` the item moves to `loopdog:needs-human`, the claim
      is released, an escalation comment (with last-failure summary + `escalate_to`
      mention) is posted, and a run record with `status: escalated` is emitted.
- [x] Backoff is exponential with cap and jitter; defaults `base: 30s`, `cap: 10m`,
      `max_attempts: 3`, all overridable per-loop with strictest-wins.
- [x] A successful transition clears the counter; a malformed/absent marker is
      treated as `count: 0` and logged (fail-open, never auto-escalate).
- [x] Escalation is idempotent (re-run on a `needs-human` item is a no-op).
- [x] A reset op clears the counter and re-arms the item (used by M16 `retry`).
- [x] An "out of budget/quota/kill-switch" park does **not** increment the counter.

## Implementation Checklist

- [x] Define `AttemptState`/`Policy`/`Decision` types + the pure
      `evaluate`/`nextBackoff`/`recordFailure` predicate in `@loopdog/core`.
- [x] Implement the attempts marker parse/serialize (per-loop keyed) over the
      `GitHubPort` in `@loopdog/runtime`.
- [x] Wire the runner's failed-step path to `recordFailure` + escalation
      (label/comment/claim-release/run-record).
- [x] Wire the sweep's eligibility selection to skip backing-off items.
- [x] Implement `resetAttempts` and success-clears-counter; reconcile hand-edits.
- [x] Load `resilience` config (repo + per-loop, strictest-wins) via `@loopdog/config`.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend) — no real quota.

```bash
# core unit (IO-free): evaluate/nextBackoff/recordFailure across boundaries
pnpm -F @loopdog/core test
# runtime behavioral (fakes): fail an item K times → backoff each time, then escalate
pnpm -F @loopdog/runtime test
#  - fail once → marker count=1, not_before set, item skipped until clock passes
#  - advance fake clock past not_before → sweep re-dispatches
#  - fail to max_attempts → label=needs-human, comment posted, run record escalated
#  - re-run escalation → no-op; success mid-way → counter cleared
#  - malformed marker → count=0 + warning; budget-park → counter unchanged
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

- Attempts ride the loopdog:attempts/N label; the ceiling (default 3,
  resilience.max_attempts_per_item) escalates to loopdog:needs-human with the
  last error in the comment (class poisoned).
- Exponential backoff between attempts: backoffUntil (30s base, doubling,
  10m cap) stamped as a loopdog:not-before/<iso> label on transient failures;
  the sweep skips future timers and clears passed ones — fully sweep-driven,
  no datastore.

## Risks / Rollback

- **Over-escalation** (counting non-attempt parks like budget/quota as failures)
  burns the human-attention budget — guard the increment to genuine transition
  failures only; the budget path (0050) must short-circuit *before* this.
- **Stuck-forever** if the sweep clock and `not_before` desync — keep the clock
  comparison in the pure predicate and test it against the fake clock.
- Rollback: this is additive; disable by setting `max_attempts` very high (items
  keep retrying with backoff but never escalate) or removing the failed-step wire.

## Final Summary

K-failure → needs-human with exponential backoff: attempts + not-before
labels make stuck detection durable and sweep-visible; M19 generalizes the
policy knobs on top of this mechanism.
