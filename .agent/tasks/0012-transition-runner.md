# 0012 Stateless Transition Runner

Status: planned  
Branch: task/0012-transition-runner

## Goal

The heart of the controller: a stateless worker that, per invocation, selects
eligible items in a state, runs **one** transition, emits a **run record**, and
writes results back — idempotently, safe under both event and cron-sweep
invocation.

## Background

Part of [Milestone 03](../milestones/milestone-03-github-state-machine-core.md).
Every loop run goes through this shell; it owns the deterministic control flow and
calls a backend (M05) for the model work. It is the source of the run records the
CLI (M16 · 0069) and telemetry (M12) consume. See [architecture](../../docs/architecture.md)
"who owns control flow" and "Triggering."

## Scope

- Select eligible items: query GitHub for items whose label = the loop's `from`
  state and that pass the loop's trigger filter.
- Run exactly one transition: pre-flight checks — gates (0014) + authorization
  (M17) + budget/quota/kill-switch + resilience policy (M19) →
  claim (0013) → compose brief → dispatch (M05) or apply the deterministic step →
  write back (labels, comments, plan update).
- Emit a **run record** for every attempt.
- Idempotency + single-step guarantee; error → backoff/escalation handoff (M12).

### Technical detail

Run record (the structure 0069/telemetry consume), one per attempt:

```yaml
run_id: run_91c           # stable, generated from (loop, item, attempt)
loop: implement
item: { repo, issue_or_pr: 142 }
trigger: { kind: event|cron, event: issues.labeled, at }
backend: claude
brief_ref: implement/prompt.md@a1b2c3d4   # <loop>/prompt.md@<sha8> (content sha) + composed-brief snapshot
steps: [ {t, kind: claim|compose|dispatch|ingest|gate|write, detail} ]
outcome: { status: done|failed|escalated, transition: ready-for-agent->in-progress,
           artifacts: { pr, plan, gh_run } }
cost: { tokens?, routine_runs?, usd? }
```

Idempotency: each transition computes a deterministic key
`(loop, item, from-state)`; before dispatching, the runner checks the item isn't
already claimed/in-flight for that key (0013) and that the target state isn't
already reached — re-running is then a no-op. Dispatch records the correlation
handle (M05 · 0073) so a re-invocation ingests the existing PR rather than
dispatching twice.

Single-step: one invocation advances an item at most one edge. Long provider work
is async — `dispatch` returns; the resulting PR is ingested by a *later* invocation
(event or sweep), keeping each run short and crash-safe.

Errors: a failed step records `status: failed`, increments the item's attempt
counter, and hands off to stuck-detection (M12 · 0051) for backoff/escalation
rather than retrying in-process.

## Out Of Scope

- The claim protocol internals (0013); gate definitions (0014); backend dispatch
  internals (M05).

## Acceptance Criteria

- [ ] One invocation advances an eligible item by exactly one transition.
- [ ] A run record (per the schema above) is emitted for every attempt.
- [ ] Re-running the same transition on an already-advanced/in-flight item is a
      no-op (idempotent), proven by a double-invocation test.
- [ ] Safe under both event and cron-sweep invocation (no double work).
- [ ] A failed step records the failure and hands off to backoff/escalation.

## Implementation Checklist

- [ ] Implement eligible-item selection (state + trigger filter).
- [ ] Implement the gate/budget/claim/compose/dispatch/write pipeline.
- [ ] Implement run-record emission to the `looper/telemetry` run-record store (0053).
- [ ] Implement the idempotency key + in-flight short-circuit.
- [ ] Wire failures to stuck-detection (M12 · 0051).

## Test Plan

```bash
# replace with the chosen stack's runner
# invoke twice on the same item → exactly one transition, one effective run
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the run-record schema, the idempotency-key derivation, and the
sync-vs-async dispatch boundary.

## Risks / Rollback

Double-dispatch is the core risk (two invocations both fire the provider); the
idempotency key + claim (0013) + correlation handle (M05 · 0073) defend it
together — all three must be in place before enabling `act` mode.

## Final Summary

Fill this in before marking verified.
