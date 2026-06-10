# 0052 Run Reporting

Status: planned  
Branch: task/0052-run-reporting

## Goal

Make every controller invocation legible with **zero hosted infra**: render each
run's transitions, steps, cost/quota, and outcome into the GitHub Actions **job
summary** and a single idempotent **issue/PR comment**, so an operator sees what
looper did — and why — straight from the GitHub UI, no CLI or dashboard required.

## Background

Part of [Milestone 12](../milestones/milestone-12-observability-cost-and-safety.md)
— Guiding Decision *"Reporting works with zero infra: Actions job summaries +
issue/PR comments + the CLI (M16); an optional dashboard is additive."* See
[architecture](../../docs/architecture.md#observability-cost--safety) ("Run
reporting with no hosted UI") and [codebase](../../docs/codebase.md) — reporting is
a thin **render layer over the run record** (M03 · 0012) emitted by the transition
runner, living in `@looper/runtime` (`runtime/src/telemetry/`). It is the
*human-facing* projection of the same data the CLI (M16 · 0069) and routing
(M13) consume; it adds **no new store** (GitHub is the only store). It is downstream
of the budget/kill-switch park (0050), stuck-detection escalation (0051), and the
dispatch/ingest correlation (M05 · 0073) — each contributes step/outcome data this
task renders. The persisted run-record format and per-provider telemetry aggregation
are 0053; this task **consumes** that record and **does not** define storage.

## Scope

- A pure **report formatter** in `@looper/core` that turns one run record (and an
  optional small set of recent runs) into Markdown blocks (summary + comment body).
- A runtime **reporter** in `@looper/runtime` that, at the end of each invocation,
  writes the Markdown to the Actions job summary and upserts the per-item comment.
- A stable **comment-anchor** scheme so a re-run updates the same comment in place
  rather than spamming the thread.
- Render the **park** (0050), **escalate** (0051), and **ingest/correlation**
  (0073) outcomes with their reasons and `retryAfter`/`not_before` where present.
- Secret-scrubbing of any rendered brief snippet/step detail (reuse M07 leak guards).

### Technical detail

**Lands in:** the pure formatter + types in `@looper/core`
(`core/src/run-record/report.ts` — IO-free, beside the run-record types from 0012);
the effectful writer in `@looper/runtime` (`runtime/src/telemetry/reporter.ts`),
called by the pipeline as the final step of every invocation. No new package, no
new IO port — the job summary is written via the `GITHUB_STEP_SUMMARY` file path
(provided by Actions) and the comment via the existing `GitHubPort` (`upsert_comment`).

**Pure formatter (`@looper/core`)** — given a `RunRecord` (0012 schema), returns
two Markdown strings:

```ts
interface RunReport { summaryMd: string; commentMd: string; }
function renderRun(run: RunRecord, opts?: { recent?: RunRecord[] }): RunReport;
function renderSweep(runs: RunRecord[]): string; // one summary table for a sweep tick
```

- **`summaryMd`** — a heading line (`run_91c · implement · #142 · done`), a one-row
  status table (backend, trigger, duration, cost/quota, outcome→artifact), the
  ordered **step trace** (timestamp · kind · detail, mirroring `looper runs show`
  0069), and footer links (PR, plan file, gh run, provider session). A **sweep**
  invocation that advances N items renders one table (`renderSweep`) — one row per
  run — so a cron tick produces a single digestible summary, not N walls of text.
- **`commentMd`** — a compact, item-scoped status: current state, last run outcome,
  cost/quota-so-far, and a `looper runs show <run>` hint. Wrapped in a hidden
  **anchor marker** so it can be found and updated:
  `<!-- looper:report item=142 -->`.

**Runtime reporter (`@looper/runtime`)** — `report(run, ctx)`:

1. Append `summaryMd` to `process.env.GITHUB_STEP_SUMMARY` (the file Actions
   renders as the job summary). If the env var is absent (local/dry-run), write to
   stdout instead — never throw. Multiple runs in one invocation each append; a
   sweep appends one `renderSweep` table.
2. **Upsert** the per-item comment via `GitHubPort`: list comments on the item,
   find one whose body contains the `looper:report item=<n>` anchor, `update` it if
   present else `create`. This keeps **exactly one** looper status comment per item.
3. **Scrub** any brief snippet/step detail through the M07 leak guard before
   writing either surface.

**Outcome rendering (downstream-aware):**

- **park** (0050): summary/comment show `parked: budget — resets ~14:00 UTC`
  (from the `gate` step's `guard`+`reason`+`retryAfter`); no step counted as a
  failure.
- **escalate** (0051): show `escalated → needs-human (3/3 attempts)` with the
  last-failure pointer and `escalate_to` mention echoed.
- **ingest** (0073): show `opened PR #143 → in-review` with the correlated PR link;
  a not-ours/`null` ingest produces **no** report (nothing happened for us).

**Config (`looper.yml`, validated by zod in `@looper/config`):**

```yaml
reporting:
  job_summary: true        # write the Actions job summary (default true)
  comment: true            # upsert the per-item status comment (default true)
  comment_on: [done, escalated, parked]  # which outcomes warrant a comment
  verbosity: normal        # quiet | normal | verbose (steps shown)
```

**Edge cases:** (a) `GITHUB_STEP_SUMMARY` unset or unwritable → log + fall back to
stdout, never fail the run (reporting is never a hard dependency of the transition);
(b) comment upsert race (two invocations) — tolerate a duplicate (advisory, like
budget 0050); the anchor de-dups on the next write; (c) a run with no item (e.g. a
pure sweep with zero advances) → emit a terse "no eligible work" summary, no
comment; (d) very long step traces → `verbosity` caps inline steps and links to
`looper runs show` for the full log; (e) deterministic ordering/timestamps under
test via the M18 clock so golden snapshots are stable.

## Out Of Scope

- The persisted run-record schema and per-provider telemetry **aggregation/storage**
  (M03 · 0012, M12 · 0053) — this task renders, it does not store.
- The CLI surfaces (`looper runs list/show`, `looper status`) — M16 · 0069/0068.
- Any hosted dashboard (additive, post-V1).
- Defining park/escalate/correlation *behavior* (0050/0051/0073) — only rendering it.
- Leak-guard implementation (M07) — this task reuses it.

## Acceptance Criteria

- [ ] Each invocation writes a job summary to `GITHUB_STEP_SUMMARY` containing the
      run's status row, ordered step trace, and artifact links (PR, plan, gh run).
- [ ] A sweep that advances N items renders **one** summary table (N rows), not N
      separate summaries.
- [ ] A single per-item comment is **upserted** via the anchor marker — re-running
      the loop updates the same comment, never adds a second.
- [ ] Park (0050), escalate (0051), and ingest (0073) outcomes render with their
      reason / `retryAfter` / PR link; a not-ours (`null`) ingest produces no report.
- [ ] Any secret value in a rendered brief/step is scrubbed (leak-guard test).
- [ ] Reporting never fails the transition: a missing/unwritable
      `GITHUB_STEP_SUMMARY` falls back to stdout and the run still succeeds.
- [ ] `reporting` config (`job_summary`/`comment`/`comment_on`/`verbosity`) gates
      what is written; defaults render summary + comment on done/escalated/parked.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add the `reporting` schema + defaults to `@looper/config` (zod).
- [ ] Implement the pure `renderRun`/`renderSweep` formatter + `RunReport` type in
      `core/src/run-record/report.ts` (IO-free, snapshot-tested).
- [ ] Implement the runtime `reporter` in `runtime/src/telemetry/`: job-summary
      append (with stdout fallback) + anchor-based comment upsert via `GitHubPort`.
- [ ] Render park/escalate/ingest outcomes from the run-record step/outcome fields.
- [ ] Reuse the M07 leak guard to scrub rendered briefs/step details.
- [ ] Wire the reporter as the final step of the transition pipeline (0012) and the
      sweep (0076) per tick.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend + deterministic clock) — **no real quota**.

```bash
pnpm vitest run packages/core packages/runtime
# core unit (IO-free, snapshot): renderRun for done/parked/escalated; renderSweep N rows
# runtime scenario (fake GitHub + fake clock):
#   advance an item → job summary written + one anchored comment created
#   re-run same item → same comment updated (no second comment)
#   sweep advances 3 items → one summary table with 3 rows
#   GITHUB_STEP_SUMMARY unset → stdout fallback, run still succeeds
#   brief with a secret → scrubbed in both summary and comment
#   not-ours ingest (null) → no summary, no comment
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the comment-anchor marker format; the stdout-fallback policy; the sweep
single-table vs. per-run choice; the `comment_on` default set; and the
`verbosity` step-cap threshold.

## Risks / Rollback

- **Comment spam** if the anchor upsert breaks — the single-comment invariant is a
  hard acceptance gate; guard it with the re-run test.
- **Secret leakage** via a rendered brief/step is the only sharp risk — the
  leak-guard scrub is mandatory, not optional (shared with 0069).
- Reporting must never block a transition; the stdout fallback + never-throw policy
  bound the blast radius. Rollback: this is additive and read-mostly — set
  `reporting.job_summary: false` + `reporting.comment: false` to disable entirely
  with no behavioral change to the loops.

## Final Summary

Fill this in before marking verified.
