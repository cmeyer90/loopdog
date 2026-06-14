# 0070 Trigger, Dry-Run & Tail (`loopdog run` / `loopdog tail` / `loopdog watch`)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Let an operator manually fire a loop, preview it safely, and follow it live:
`loopdog run <loop> [--issue N] [--dry-run]`, `loopdog tail <run>`, `loopdog watch`.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. Manual trigger + dry-run is how an
operator tests a loop or unblocks an item without waiting for the next event/sweep
(M02); tail/watch make in-progress runs observable. Triggers go through the same
controller path (claim → compose → dispatch → ingest) and honor the same safety
gates as automated runs.

## Scope

- `loopdog run <loop> [--issue/--pr <n>] [--dry-run] [--backend <p>] [--reason <s>]`
  — dispatch one transition; `--dry-run` previews with no writes.
- `loopdog tail <run>` — stream a single run's step log live (`--json` = NDJSON).
- `loopdog watch` — auto-refreshing view of all active runs.
- Honor budget/quota/kill-switch; `--force` may override soft budget but never the
  kill switch or human-gated tiers.

### Command Surface (acceptance reference)

```
$ loopdog run implement --issue 142 --dry-run
[dry-run] loop implement on #142
  would compose brief from plan 0001 · would dispatch claude routine
  would NOT modify the repo

$ loopdog run implement --issue 142
✓ dispatched run_9f0 (implement #142)   → loopdog tail run_9f0

$ loopdog tail run_9f0
14:20:01 claim     #142 claimed
14:20:05 dispatch  routine fired → session def456
14:23:18 work-cell running tests… 42 passing
14:25:02 ingest    PR #145 opened   ✓ done
```

## Out Of Scope

- Reviewing past runs (0069), changing modes/budgets (0071).

## Acceptance Criteria

- [x] `loopdog run <loop> --dry-run` previews the composed brief + intended writes
      and performs **no** writes.
- [x] `loopdog run <loop> --issue N` dispatches one transition and returns a run id.
- [x] Trigger honors budget/quota/kill-switch; `--force` cannot bypass the kill
      switch or human-gated (`tier:core`) merges.
- [x] `loopdog tail <run>` streams steps live and exits when the run ends;
      `--json` emits NDJSON.
- [x] `loopdog watch` shows all active runs and refreshes.

## Implementation Checklist

- [x] Implement `run` invoking the controller path with a dry-run mode.
- [x] Enforce safety gates before dispatch; implement `--force` semantics.
- [x] Implement `tail` (single-run stream) and `watch` (fleet refresh).
- [x] Record an audit entry (who/why) for manual triggers.

## Test Plan

```bash
# replace with the chosen stack's test runner
# loopdog run groom --issue 1 --dry-run ; loopdog tail <run> --json
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `loopdog loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

`loopdog run <loop> [--issue N] [--dry-run]` calls the new controller
`handleRun` (targets one item or the from-state scan), honoring every gate;
`--dry-run` sets forceDryRun (tighten-only). `loopdog tail` (alias `watch`)
polls the day's run records, printing new ones; `--once` gives a single
snapshot for scripts/tests. Live tailing of an in-flight provider session is
the provider's UI; loopdog tails its own run records.

## Risks / Rollback

Trigger is a write path — the kill-switch and tier gates are hard limits
`--force` must not cross. Dry-run must be provably side-effect-free.

## Final Summary

`loopdog run` triggers a loop now (one issue or the whole from-state) under
the real gates with tighten-only --dry-run; `loopdog tail/watch` streams new
run records. Both reuse the controller and the ledger — no new surface.
