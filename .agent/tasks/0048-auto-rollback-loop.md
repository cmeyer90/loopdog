# 0048 Auto-Rollback Loop

Status: planned  
Branch: task/0048-auto-rollback-loop

## Goal

Make a failed deploy self-healing: when the post-deploy smoke/canary + health gate
(0047) fails, a **first-class rollback loop** automatically reverts the affected
target via the project adapter and **re-verifies health** — so "deployed" reliably
implies "deployed and healthy," and a bad release never silently sits live.

## Background

Part of [Milestone 11](../milestones/milestone-11-deploy-and-operational-verification.md)
— "rollback as a first-class loop with its own trigger" (Guiding Decisions) and
verification-ladder rung 4 in
[architecture](../../docs/architecture.md#the-verification-ladder-trust)
("Deploy-time smoke/canary + health checks → auto-rollback"; "Rollback as a
first-class loop"). It consumes the adapter-driven deploy (0046) and the
smoke/canary & health gate (0047), and feeds deploy result reporting (0049). Like
every loop, it is **data, not core code**: a `templates/loops/rollback/` asset
(`loop.yml` + `prompt.md`) executed by the generic runtime pipeline (M03 · 0012),
not a new code module. Its deterministic, model-free transition lands in
`@looper/runtime`; the revert/health commands run through the `ProjectAdapter` port
(0024) in `@looper/adapters`.

## Scope

- A built-in `rollback` loop asset under `templates/loops/rollback/` (`loop.yml` +
  `prompt.md`), with the `looper:state/deploy-failed → rolled-back` transition.
- A **deterministic** rollback transition (no model dispatch on the primary path):
  invoke the adapter's revert, then re-run the health/smoke checks (0047) against
  the rolled-back target, and record the outcome.
- Failure-triggered entry: the deploy gate (0047) parking a release in
  `looper:state/deploy-failed` is what fires this loop; dual-trigger via the
  `check_suite`/deploy-status event **and** the cron sweep (0076), since the
  failing transition is a controller→controller handoff `GITHUB_TOKEN` won't
  re-fire.
- Outcome states: health restored → `looper:state/rolled-back`; rollback itself
  failed or health still bad → `looper:needs-human` (page the escalation target).

### Technical detail

**Loop asset** (`templates/loops/rollback/loop.yml`):

```yaml
name: rollback
trigger: { github_event: check_suite }     # + picked up by the cron sweep (0076)
transition: { from: deploy-failed, to: rolled-back }
backend: none                              # deterministic; no provider dispatch
gates: { tier: core }                      # rollback is always high-trust
rollback:
  strategy: adapter                        # adapter | redeploy-previous | revert-commit
  reverify: true                           # re-run 0047 health/smoke after revert
  max_attempts: 1                          # one revert attempt, then needs-human
  on_unrecoverable: needs-human            # page escalate_to (M19)
```

**Why deterministic / `backend: none`.** Rollback must be the *least* fakeable,
most reliable step in the ladder — a model has no role on the primary path. The
runner runs the loop's transition logic directly: it reads the run record's deploy
artifacts (target id, previous-good ref/version captured by 0046 *before* it
promoted), calls `adapter.deploy(ctx)` in **revert mode** (or `redeploy-previous` /
`revert-commit` per `strategy`), then re-invokes the 0047 health/smoke assertions
and writes a `RollbackResult` into the run record.

**Rollback strategies** (selected per `loop.yml`, defaulting to `adapter`):

- `adapter` — call the `ProjectAdapter.deploy(ctx)` (0024) with a `rollback` flag in
  `CommandContext.env`/options; the adapter owns *how* to revert (its `deploy`
  knows the target). Generic adapter shells the configured `adapter.commands.rollback`.
- `redeploy-previous` — re-deploy the last-known-good artifact/ref recorded by 0046.
- `revert-commit` — open a revert PR for the merge commit (slowest; for targets
  with no in-place revert) and let normal deploy re-run.

**State + trigger flow** (no DB, GitHub-as-bus):

```
0046 deploy → 0047 gate fails
   → label item looper:state/deploy-failed   (controller→controller handoff)
   → THIS loop fires (check_suite event OR next cron sweep tick, 0076)
   → claim (0013) → adapter revert (strategy) → re-run 0047 health/smoke
       ├─ healthy  → looper:state/rolled-back   + report (0049)
       └─ still bad / revert failed → looper:needs-human (page escalate_to, M19)
```

**Run record extension** (the structure 0069/telemetry consume, per 0012):

```yaml
rollback:
  trigger: { kind: event|cron, from: deploy-failed }
  strategy: adapter
  revert: { ok: true, output, durationMs }        # adapter CommandResult (0024)
  reverify: { ok: false, checks: [ {name, ok, output} ] }  # 0047 assertions
  outcome: { status: rolled-back|unrecoverable, target, previous_ref }
```

**Idempotency & safety.** The transition is idempotent on `(loop=rollback, item,
from=deploy-failed)` (0012): if the target is already at the previous-good ref
(re-invocation, or an event racing the sweep) the revert is a no-op and re-verify
just confirms health — no double-revert. Claim/lease (0013) serializes concurrent
ticks. If `adapter.deploy` reports `skipped: true` (target has no revert command),
the loop fails closed to `needs-human` rather than declaring success.

**Resilience hookup (M19 · 0091).** `max_attempts: 1` deliberately overrides the
generic retry policy — re-attempting a failed rollback risks compounding an outage;
instead it escalates immediately to `escalate_to`. The circuit breaker still
applies if the adapter/provider is down. An unrecoverable rollback is never
silently dropped: it lands in `looper:needs-human` with the full `RollbackResult`
recorded.

**Pre-flight gates** still run (0012): `tier: core` keeps rollback high-trust, and
authorization (M17) treats the deploy gate / cron as the trusted system actor —
a stranger cannot trigger a rollback storm.

## Out Of Scope

- The deploy itself and capturing the previous-good ref/artifact (0046).
- Defining the smoke/canary/health assertions and the gate predicate (0047) — this
  loop *re-invokes* them, it does not define them.
- The `ProjectAdapter` interface and the `deploy`/revert command contract (0024).
- Reporting the final outcome onto the PR/issue/plan (0049) — this loop produces
  the `RollbackResult`; 0049 renders it.
- Model-driven "diagnose why it broke" analysis (post-V1).

## Acceptance Criteria

- [ ] A built-in `rollback` loop ships as `templates/loops/rollback/` assets
      (`loop.yml` + `prompt.md`) and validates against the state machine (M03).
- [ ] A 0047 gate failure parks the release in `looper:state/deploy-failed`, and
      this loop fires from **both** the `check_suite` event and the cron sweep
      (0076) — the controller→controller handoff is never stranded.
- [ ] The rollback transition is deterministic (`backend: none`, no model
      dispatch) and reverts via the configured `strategy` through the adapter (0024).
- [ ] After revert it **re-runs** the 0047 health/smoke checks; only a passing
      re-verify advances to `looper:state/rolled-back`.
- [ ] A failed revert or a still-unhealthy re-verify routes to `looper:needs-human`
      and pages `escalate_to` (M19) — never a false "rolled-back".
- [ ] The transition is idempotent: re-invoking on an already-reverted target (event
      racing sweep, or duplicate delivery) is a no-op proven by a double-invocation
      test.
- [ ] A `RollbackResult` is written into the run record for 0049/telemetry to consume.

## Implementation Checklist

- [ ] Author `templates/loops/rollback/{loop.yml,prompt.md}` with the
      `deploy-failed → rolled-back` transition and `backend: none`.
- [ ] Implement the deterministic rollback transition in `@looper/runtime`
      (`pipeline`/`loops-builtin`): read deploy artifacts → adapter revert by
      `strategy` → re-run 0047 checks → write `RollbackResult`.
- [ ] Add the `rollback` strategy switch (`adapter` / `redeploy-previous` /
      `revert-commit`) and the `rollback` env/flag on `CommandContext` for the
      adapter path (coordinate with 0024).
- [ ] Wire the `check_suite`/deploy-status event trigger and confirm the cron sweep
      (0076) also advances `looper:state/deploy-failed` items.
- [ ] Wire the unrecoverable path to `looper:needs-human` + M19 escalation; honor
      `max_attempts`/`on_unrecoverable`.
- [ ] Extend the run record with the `rollback` block; expose it to 0049.

## Test Plan

Tests run via the repo's vitest runner; behavioral cases use the M18 fakes
(in-memory GitHub + fake/recorded backend + fake adapter `CommandRunner`) so **no
real quota or live deploy** is touched.

```bash
# scenario (fake GitHub + fake adapter):
#   deploy → 0047 gate fails → item parked deploy-failed
#     → rollback loop reverts (fake adapter) → re-verify healthy → rolled-back
#   re-verify still failing → needs-human, escalate paged, no false success
#   adapter revert returns skipped:true → fail closed to needs-human
# simulation (deterministic clock + fault injection):
#   suppress the check_suite event → cron sweep (0076) picks up deploy-failed
#   event races sweep on same item → exactly one revert (idempotent, claim-protected)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the rollback `strategy` default + selection, the previous-good-ref source
(captured by 0046), the `RollbackResult` schema, the `max_attempts: 1` rationale,
and the fail-closed (`skipped`/error → `needs-human`) policy.

## Risks / Rollback

A buggy rollback during an outage compounds it — hence `backend: none`
(deterministic), `max_attempts: 1`, fail-closed semantics, and `tier: core` so it
never auto-experiments. A re-verify that passes against a *stale/cached* target
could declare false health: 0047 must assert against the live rolled-back instance.
If the adapter has no revert path, the loop escalates to a human rather than
guessing. Disabling is low-cost: remove the loop asset or flip its trigger off —
deploys then fail to `needs-human` instead of auto-reverting.

## Final Summary

Fill this in before marking verified.
