# 0073 Dispatch & Result Ingestion (correlation)

Status: planned  
Branch: task/0073-dispatch-and-result-ingestion

## Goal

Reliably connect a dispatched run to the PR/comments the provider cloud agent
produces — the correlation + ingestion primitive that lets the async
dispatch→ingest split work without double-dispatching or losing work.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md);
shared by all backends (0019). This is the **riskiest new primitive**: dispatch is
async and the provider opens the PR out-of-band, so looper must recognize "this PR
is the result of run X on issue #N" from a GitHub event, exactly once. See
[architecture](../../docs/architecture.md) "Execution model."

## Scope

- A correlation scheme tying a dispatch to its resulting PR/comments.
- The ingest path: GitHub event → match → update run record + plan + labels.
- Idempotent ingest (same event delivered twice) and the no-result/timeout path.

### Technical detail

**Correlation — defense in depth (don't rely on one signal):**

1. **Branch convention**: brief instructs the agent to branch
   `looper/<loop>/<issue>-<run_id>` → the PR head branch encodes the run.
2. **PR body marker**: brief requires a trailer `looper-run: <run_id>` in the PR
   body → a parseable, branch-independent backup.
3. **Issue linkage**: PR references `#<issue>` (closes/relates) → ties to the item.

Ingest matches on (1) then (2) then (3); a PR matching none is **not ours** and
`ingest` returns `null`.

**Ingest path** (called by the runner on `pull_request` / `issue_comment` /
`check_suite` events): parse the correlation → load the run record → append ingest
step → update the durable plan (checklist, verification log) → set the item's
label to the loop's `to` state. **Idempotent**: ingesting the same PR event twice
is a no-op (guard on "already ingested for this run").

**Timeout / no-result**: a dispatch with no correlated PR within the lease window
(0013) is detected by the **cron sweep** → records `failed`/`escalated`, hands to
backoff (M12 · 0051). Prevents a silently-dropped provider job from stranding the
item.

**Double-dispatch guard**: before dispatching, the runner checks no open
correlated artifact exists for the run key (0012 idempotency) — so a re-invocation
ingests the existing PR instead of firing again.

## Out Of Scope

- Provider-specific dispatch calls (0020/0021); claiming/leases (0013).

## Acceptance Criteria

- [ ] A dispatched run is correlated to its PR via branch name, body marker, and
      issue ref (any sufficient), and unrelated PRs are ignored.
- [ ] Ingest updates the run record, the durable plan, and the item label, and is
      idempotent under duplicate event delivery.
- [ ] A dispatch that never yields a PR within the lease is detected by the sweep
      and escalated, not stranded.
- [ ] A re-invocation ingests the existing PR rather than double-dispatching.

## Implementation Checklist

- [ ] Define the correlation scheme (branch + marker + issue ref) and brief
      instructions that produce it.
- [ ] Implement the ingest matcher + the not-ours `null` path.
- [ ] Implement idempotent ingest + plan/label updates.
- [ ] Implement the sweep-driven timeout/no-result escalation.

## Test Plan

```bash
# replace with the chosen stack's runner
# dispatch → simulate the agent's PR → ingest correlates + advances once
# deliver the same PR event twice → single effect; drop the PR → sweep escalates
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the branch/marker conventions, match precedence, and the lease-timeout
default.

## Risks / Rollback

This is the highest-risk primitive: a correlation miss double-dispatches or
strands work. The three-signal match + idempotent ingest + sweep timeout must all
land before any loop runs in `act` mode. Spike it against a real provider early.

## Final Summary

Fill this in before marking verified.
