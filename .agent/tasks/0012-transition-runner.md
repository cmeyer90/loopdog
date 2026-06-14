# 0012 Stateless Transition Runner

Status: verified  
Branch: claude/laughing-johnson-8a7944

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

- [x] One invocation advances an eligible item by exactly one transition
      (deterministic loop: one step + no-op re-run test; work-cell loop:
      dispatch-then-ingest across two invocations).
- [x] A run record (per the schema) is emitted for every attempt and appended
      to the store; eligible-but-skipped sweeps emit nothing (no record spam).
- [x] Re-running on an already-advanced/in-flight item is a no-op — proven by
      double-invocation tests (deterministic + work-cell + silent-work-cell).
- [x] Safe under both event and cron-sweep invocation: the concurrent
      event-vs-sweep race test proves exactly one dispatch.
- [x] A failed step records the failure (class `transient`), releases the
      claim, bumps `loopdog:attempts/N`, and escalates to `loopdog:needs-human`
      at the attempt ceiling (class `poisoned`) — M12/M19 refine this policy.

## Implementation Checklist

- [x] Implement eligible-item selection (event item or from-state scan).
- [x] Implement the gate/claim/compose/dispatch/write pipeline (extra checks —
      budget/auth/resilience — compose in via `RunnerDeps.extraChecks`).
- [x] Implement run-record emission (`TelemetryBranchStore` → day-bucketed
      NDJSON on `loopdog/telemetry` with CAS-retry append; in-memory store for tests).
- [x] Implement the idempotency key + in-flight short-circuit (pending dispatch
      markers take precedence over re-dispatch; live claims skip; reached
      target no-ops).
- [x] Wire failures to attempts-label + needs-human escalation (the basic
      0051 behavior; full policy lands with M12/M19).

## Test Plan

```bash
# replace with the chosen stack's runner
# invoke twice on the same item → exactly one transition, one effective run
```

## Verification Log

- 2026-06-09: runner suite green (8 tests): dispatch→marker→in-progress;
  later-invocation ingest→in-review + PR labeled + claim released; third
  invocation no-op with zero re-dispatch; event/sweep race → one dispatch;
  silent work cell stays pending without stranding; DoR routes to
  needs-grooming with comment; dispatch failure → release + attempts +
  escalate at ceiling; deterministic loop single-step + no-op re-run;
  dry-run comment-only with sticky comment.
- 2026-06-09: full `npm run lint` + `npm run build` green.

## Decisions

- Run-record schema as specced (type in core `run-record/`); records are
  emitted for attempts and notable blocks (park/route/escalate), NOT for
  routine skip/no-op sweep passes — sweeps would otherwise flood the store.
- Idempotency: `idempotencyKey(loop, item, from)`; in practice the runner's
  short-circuits are (a) pending dispatch marker → ingest instead of dispatch,
  (b) live claim → skip, (c) target state reached → no-op.
- **Sync-vs-async boundary:** `dispatch` persists a marker comment with the
  full `DispatchHandle` (incl. the authoritative dispatch-time correlation
  signal, 0093) and returns — the same or a later invocation ingests. A
  dispatching loop marks the canonical intermediate `in-progress` state when
  the table has that edge.
- Failure handling: release claim BEFORE bumping attempts (item never stays
  locked by a dead run); attempts ride a `loopdog:attempts/N` label so the
  sweep sees them without a datastore.
- The claim CAS uses an invocation-unique claimant nonce (see 0013 decisions)
  — without it, the deterministic runId let event+sweep races double-dispatch.

## Risks / Rollback

Double-dispatch is the core risk (two invocations both fire the provider); the
idempotency key + claim (0013) + correlation handle (M05 · 0073) defend it
together — all three must be in place before enabling `act` mode.

## Final Summary

`runLoopOnce` in `@loopdog/runtime/pipeline/` is the stateless single-step
worker: select (event item or state scan) → decide (standard checks + DoR gate
+ composable extra checks) → claim (nonce'd CAS) → compose brief (versioned
`briefRef`) → dispatch + persist handle marker → and on a later invocation
ingest → advance → release → record. Deterministic loops apply inline.
Dry-run is comment-only with a sticky comment. Failures release, count
attempts, and escalate at the ceiling. Proven idempotent and race-safe on the
fake GitHub + scripted fake backend.
