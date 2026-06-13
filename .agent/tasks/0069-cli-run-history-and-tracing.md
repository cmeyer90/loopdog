# 0069 Run History & Tracing (`looper runs list` / `looper runs show`)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Let an operator trace any loop run from the CLI: `looper runs list` to browse
history, and `looper runs show <run>` to see exactly **what ran, how it was
prompted (the dispatched brief), what its specific steps were**, the provider
session + resulting PR, and cost/quota/outcome.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. This is the command that makes the
loops auditable — the answer to "what did looper do on this issue, and why." It
reads run telemetry (M12 · 0053), the dispatched brief composed from the prompt
artifact (M05 · 0022) + plan (M04), and links out to the provider session and PR.
A run record is emitted by the controller for every transition; this task
specifies that record's shape *as consumed by the CLI* and the rendering.

## Scope

- `looper runs list` — table of recent runs. Flags `--loop <l>`, `--item <#>`,
  `--status <s>`, `--since <when>`, `--limit <n>`, `--json`.
- `looper runs show <run>` — full trace (see Command Surface). Flags `--brief`
  (full composed brief), `--steps` (full step log), `--logs` (scrubbed provider
  session log if available), `--json`.
- Secret-scrubbing of any displayed brief/log (reuse M07 leak guards).

### Command Surface (acceptance reference)

```
$ looper runs list --loop implement --limit 3
RUN      LOOP       ITEM  BACKEND  STARTED   DUR    STATUS  RESULT
run_91c  implement  #142  claude   18m ago   6m12s  done    PR #143 (in-review)
run_88a  implement  #139  claude   2h ago    4m02s  done    PR #140 (merged)
run_82f  implement  #137  claude   5h ago    7m44s  failed  tests red → changes-requested

$ looper runs show run_91c
Run run_91c   loop: implement   item: #142 "Add rate limiting to the public API"
  Backend:  claude (subscription)   session: https://claude.ai/code/s/abc123
  Trigger:  event issues.labeled=ready-for-agent @ 14:02        # what fired it
  Status:   done   duration: 6m12s   cost: 2 routine runs (quota), $0
  Outcome:  opened PR #143 → in-review

  Dispatched brief:                          # HOW IT WAS PROMPTED (composed for this run)
    ┌ from implement/prompt.md@a1b2c3d4 + plan 0001 acceptance criteria
    │ "Implement per-API-key rate limiting (100 req/min) in src/api/… add tests.
    │  Stay within 20 files / 400 lines. …"
    └ full: looper runs show run_91c --brief

  Steps:                                     # WHAT ITS SPECIFIC STEPS WERE
    14:02:03  claim        #142 claimed (assign-bot, label in-progress)
    14:02:05  compose      brief built from plan 0001 (3 acceptance criteria)
    14:02:07  dispatch     Claude routine fired → cloud session abc123
    14:05:40  work-cell    edited 4 files (+128/-6), ran `npm test` → 42 passing
    14:08:09  ingest       opened PR #143, posted plan-contract, label in-review
    14:08:12  plan-update  task 0001 checklist 3/5, verification log appended

  Artifacts: PR #143 · plan .looper/plans/tasks/0001-api-rate-limiting.md · gh run 1234
```

## Out Of Scope

- Live tailing of an in-progress run (0070 `looper tail`).
- Loop-level (not run-level) introspection (0068).

## Acceptance Criteria

- [x] `looper runs list` filters by loop/item/status/since with a `--limit`;
      `--json` mirrors columns.
- [x] `looper runs show <run>` shows backend + provider session link, trigger,
      status/duration/cost/quota, the **composed dispatched brief**, the ordered
      **step trace** with timestamps, and artifact links (PR, plan, gh run).
- [x] `--brief` prints the full composed brief; `--steps` the full step log;
      `--logs` the scrubbed provider log when available.
- [x] Any secret value is scrubbed from brief/log output (leak-guard test).
- [x] Unknown run id exits `2`; `--json` is stable.

## Implementation Checklist

- [x] Define the run-record shape the CLI consumes (id, loop, item, backend,
      trigger, brief ref, steps[], artifacts, cost/quota, outcome).
- [x] Implement `list` (filters + `--json`) and `show` (trace + `--brief/--steps/--logs`).
- [x] Reuse M07 leak guards to scrub displayed brief/logs.
- [x] Link out to provider session, PR, plan file, and the GitHub Actions run.

## Test Plan

```bash
# replace with the chosen stack's test runner
# looper runs show run_91c --json | jq '.steps' ; looper runs show run_91c --brief
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `looper loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

`looper runs list/show/stats` read the run-record ledger from the
looper/telemetry orphan branch (TelemetryBranchStore.readDay over a --since
window). show renders the item, trigger, status/transition, cost, briefRef,
the full step trace, failure class, and artifacts (PR/plan/session). Records
are already secret-scrubbed at the store's egress (M07), so the CLI displays
them as-is. Added `runs stats` (the 0053 aggregates) as the data behind
routing.

## Risks / Rollback

Read-only, low risk — except secret leakage via displayed briefs/logs; the
leak-guard scrub is a hard acceptance gate, not optional.

## Final Summary

`looper runs list/show/stats` trace runs from the durable ledger: filterable
history, a full per-run step trace with artifacts and cost, and per-(loop,
backend) success aggregates — all --json-able, all from GitHub state.
