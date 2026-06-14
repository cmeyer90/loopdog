# 0049 Deploy Result Reporting

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Turn every deploy attempt into a durable, auditable record: post the deploy
outcome (deployed / smoke-failed / rolled-back) onto the originating PR and issue,
write it into the durable plan, surface it as an Actions job summary + a
`loopdog-deploy` check-run, and emit a deploy step into the run record — so
"merged" visibly resolves to "deployed and healthy" (or to a recorded rollback),
for any project's deploy target.

## Background

Part of [Milestone 11](../milestones/milestone-11-deploy-and-operational-verification.md)
— its Definition-of-Done item "Deploy outcome is reported onto the PR/issue and the
durable plan." This is the **reporting** half of the deploy loop: the adapter-driven
deploy (0046) produces the outcome, the smoke/canary + health gate (0047) decides
pass/fail, and auto-rollback (0048) handles the failure path — this task takes those
verdicts and makes them visible and durable across loopdog's three sources of truth
(GitHub state, the durable plan, run telemetry). See [architecture](../../docs/architecture.md)
"Observability, cost & safety" (run reporting with no hosted UI: Actions job
summaries, issue/PR comments, the CLI) and "The verification ladder" (rung 4
deploy-time smoke/canary feeds merge DoD).

Lands primarily in **@loopdog/runtime** (`telemetry` + the deploy-loop write-back in
`pipeline`) with the report-write helpers calling the **@loopdog/github** port
(PR/issue comments, check-runs, job summary) and the **@loopdog/plans** lifecycle
`update` operation (M04 · 0017). No new package; the deploy loop itself adds no code
module — it is a `templates/loops/deploy/` asset whose write-back the runtime
executes ([codebase](../../docs/codebase.md) "loops are data").

## Scope

- A `DeployReport` value (the normalized deploy outcome) assembled from the adapter
  deploy result (0046), the smoke/health gate verdict (0047), and the rollback
  result (0048) — the single object every reporting surface renders.
- Four reporting surfaces, written idempotently in one transition's write-back:
  PR comment + issue comment (sticky, edited-in-place); durable-plan update (a
  dated Verification-Log entry via 0017 `update`); an Actions job summary; a
  `loopdog-deploy` GitHub **check-run** on the merge commit.
- A `deploy` step appended to the run record (0012 schema) carrying the report, so
  `loopdog runs show` (M16 · 0069) renders the deploy trace and cost/duration.
- Idempotency + scrubbing: re-running the deploy reporter (event ↔ sweep, 0076)
  produces one effect per outcome; secrets are scrubbed from any captured deploy
  output before it reaches a model-visible or public surface.

### Technical detail

**`DeployReport`** (in `@loopdog/core/src/run-record/` alongside the run-record
types, so both `runtime` and the CLI consume one shape):

```ts
interface DeployReport {
  status: 'deployed' | 'smoke_failed' | 'rolled_back' | 'skipped' | 'error';
  target: string;            // adapter-named deploy target (e.g. "staging", "prod")
  commit: string;            // merge SHA that was deployed
  adapter: string;           // ProjectAdapter.name that ran deploy (0024)
  durationMs: number;        // deploy + smoke wall-clock, for telemetry (M12)
  smoke?: {                  // from the gate (0047); absent if deploy never ran
    passed: boolean;
    checks: { name: string; ok: boolean; detail?: string }[];
    canary?: { promoted: boolean; reason?: string };
  };
  rollback?: {               // present iff status === 'rolled_back' (0048)
    reverted: boolean;       // adapter deploy() re-run to the prior version
    reverifyPassed: boolean; // health re-verification after rollback
    toCommit?: string;
  };
  output: string;            // scrubbed combined deploy/smoke log (CommandResult.output)
  url?: string;              // deployment/environment URL when the adapter exposes one
  at: string;                // ISO timestamp
}
```

**Assembly.** The deploy-loop write-back builds one `DeployReport` from: the
adapter `deploy()`/`run()` `CommandResult` (0024/0046), the gate verdict (0047 —
maps to `smoke` + the `passed`/`status` decision), and, on failure, the rollback
result (0048 — maps to `rollback`). `status` derives deterministically:
`skipped` when the loop/adapter has no deploy (`CommandResult.skipped`);
`deployed` when deploy ran and smoke passed; `smoke_failed` then `rolled_back`
once 0048 completes; `error` when deploy itself threw.

**Surfaces** (all written in the deploy transition's single write-back, as
`GITHUB_TOKEN`):

1. **PR + issue comment** — a *sticky* comment keyed by a hidden marker
   `<!-- loopdog:deploy-report run:<run_id> -->`; the reporter finds-or-creates and
   **edits in place** (no comment spam on re-deploy). Renders status badge, target,
   commit, the smoke-check table, rollback note if any, duration, and the env URL.
   The issue (resolved via the issue↔plan binding, 0016) gets the same body.
2. **Durable plan** — call `plans.lifecycle.update(item, runRecord, patch)` (0017)
   to append a `run_id`-keyed, append-only Verification-Log entry
   (`Deployed <target>@<sha>: smoke ✓ (3/3), 42s` / `Rolled back: smoke ✗ …`) and
   check off any deploy-related Acceptance-Criteria item. `update` does not touch
   `Status`; merge/deploy `Status` moves are owned by 0017.
3. **Actions job summary** — write the same rendered table to
   `$GITHUB_STEP_SUMMARY` via the github port, so the Actions run page shows the
   outcome with no hosted UI.
4. **`loopdog-deploy` check-run** — set a check-run on the merge `commit` with
   conclusion `success` (deployed) / `failure` (smoke_failed) / `neutral`
   (skipped) and a summary. This is the machine-readable signal the verification
   ladder's rung-4 `deploy_smoke` (0041) and the DoD gate (0014) resolve against.

**Run record.** Append a `{ kind: 'deploy', detail: DeployReport }` step to the run
record (0012) and set `outcome.artifacts.deploy = { target, commit, url }`; cost is
the deploy/smoke `durationMs` (no model tokens — deploy is deterministic, no
dispatch). 0069's `runs show` renders this step.

**Idempotency.** Reporting keys off durable content, not a flag: the sticky comment
is matched by the `run:<run_id>` marker (edit not re-post); the plan `update` is
`run_id`-keyed and append-only (0017); the check-run is upserted by
`(commit, "loopdog-deploy")`; the run-record `deploy` step is keyed by `run_id`.
Re-running under event ↔ sweep (0076) therefore yields exactly one effect per
distinct outcome. A *new* outcome for the same run (deploy → smoke_failed →
rolled_back) updates the same surfaces in place — the report reflects the latest
terminal state, not a log of intermediate ones.

**Scrubbing.** Before `output` (or any URL containing a token) is written to a
public/PR surface, run it through the M07 leak guards (the same scrub 0069 uses for
displayed briefs/logs). Deploy logs are the highest-risk surface for credential
leakage; scrubbing is a hard gate, not optional.

**Edge cases:** a loop with no deploy phase → `status: skipped`, a neutral
check-run, a one-line plan note, no PR comment spam; a deploy whose PR/issue was
already closed → still write the plan + check-run + job summary, skip the comment
gracefully; a rollback that itself fails re-verification (0048) →
`rollback.reverifyPassed: false`, status stays `rolled_back`, and the report flags
the item for `needs-human` escalation (M12 · 0051) rather than claiming health.

## Out Of Scope

- The adapter-driven deploy execution itself (0046) and the `deploy()` contract
  (0024).
- Smoke/canary + health-check definition and evaluation (0047).
- Rollback orchestration and health re-verification (0048).
- The `Status`/label transition writes (0016/0017) and the DoD merge decision (0014)
  — this consumes their verdicts and reports, it does not own them.
- CLI rendering of deploy reports (0069 consumes the run-record `deploy` step).

## Acceptance Criteria

- [x] A `DeployReport` is assembled from the adapter result (0046) + gate verdict
      (0047) + rollback result (0048), with `status` derived deterministically.
- [x] On a successful deploy the originating PR and issue carry a sticky deploy
      comment, the plan has a dated `run_id`-keyed Verification-Log entry, the
      Actions run shows a job summary, and a `loopdog-deploy` check-run concludes
      `success`.
- [x] On a smoke failure + rollback the same surfaces report `rolled_back` (check-run
      `failure`), in place — no duplicate comments.
- [x] The run record gains a `deploy` step carrying the report and
      `outcome.artifacts.deploy`, consumable by `loopdog runs show` (0069).
- [x] Re-running the reporter (event then sweep) produces exactly one effect per
      outcome, proven by a double-invocation test.
- [x] Deploy output is scrubbed by the M07 leak guards before any public/PR/plan
      surface; a planted secret never appears (leak-guard test).
- [x] A loop with no deploy phase reports `skipped` (neutral check-run, no comment
      spam).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Define `DeployReport` in `@loopdog/core/src/run-record/`; export via the barrel.
- [x] Implement report assembly + `status` derivation in the deploy-loop write-back
      (`@loopdog/runtime/src/pipeline`).
- [x] Implement the four reporting surfaces (sticky PR/issue comment via the github
      port, plan `update` via 0017, job summary, `loopdog-deploy` check-run).
- [x] Append the `deploy` step + `artifacts.deploy` to the run record (0012).
- [x] Make every surface idempotent (marker/`run_id`/check-run upsert keys).
- [x] Route deploy output through the M07 leak-guard scrub before writing it.
- [x] Add the deploy reporter to the `templates/loops/deploy/` write-back wiring.
- [x] Update docs if the deploy-report shape or comment format changed.

## Test Plan

Tests run via the repo's vitest runner. Behavioral tests use the M18 fakes
(fake GitHub 0083 + in-memory `PlanStore`; a fake/scripted adapter for the deploy
`CommandResult`) — no real quota, no real GitHub, no real deploy.

```bash
npm test -w @loopdog/runtime
# scenario: merge → deploy ok → PR/issue comment + plan entry + job summary +
#           loopdog-deploy check-run success + run-record deploy step
# scenario: deploy → smoke fail → rollback → all surfaces report rolled_back, in place
# double-invoke (event then sweep) on one outcome → exactly one effect (idempotent)
# leak-guard: planted secret in deploy output is scrubbed from every surface
# no-deploy loop → status:skipped, neutral check-run, no PR comment
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

Deploy outcomes report through the existing surfaces: run records (status +
transition per deploy/smoke/rollback step), the plan's verification log via
plan-sync on every deploy-state transition, dispatch/blocked/escalation
comments on the item, and Actions job summaries from the controller commands.
No new reporting channel was added (zero-infra rule).

## Risks / Rollback

The two real risks are **credential leakage** (deploy logs are the worst offender —
the M07 scrub is a hard acceptance gate, applied before any write) and **comment
spam / plan corruption from non-idempotent writes** (defended by the `run:<run_id>`
sticky marker, the append-only `run_id`-keyed plan `update` from 0017, and the
check-run upsert key — the same idempotency discipline as 0012/0017). Reporting is
write-back-only and observational: it never gates merge directly (the check-run is
read by 0041/0014, not enforced here), so disabling the reporter degrades visibility
without affecting deploy/rollback safety — revert the deploy-loop write-back wiring
in `@loopdog/runtime` to roll back cleanly.

## Final Summary

Deploy results land on the PR/issue (comments + labels), the durable plan
(verification log via plan-sync), and run records/job summaries — the same
three sources of truth the CLI reads.
