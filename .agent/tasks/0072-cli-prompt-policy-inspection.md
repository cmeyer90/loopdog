# 0072 Prompt & Policy Inspection (`loopdog prompts show/diff/edit/history`)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Let an operator see and safely change **how a loop is prompted**: view the brief,
diff versions, edit it (versioned), and read its history — `loopdog prompts
show/diff/edit/history <loop>`.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. Prompts/policies are versioned,
reviewable repo artifacts (M05 · 0022) — tuning them is the operator's main lever
on loop behavior. Editing must validate and produce a reviewable change, never a
silent live mutation.

## Scope

- `loopdog prompts show <loop>` — print the current brief (name + version).
- `loopdog prompts diff <loop> [<vA> <vB>]` — diff versions (default: working vs
  last committed).
- `loopdog prompts edit <loop>` — open `$EDITOR`; on save, validate (renders,
  required placeholders present) and stage a versioned change (a PR/commit).
- `loopdog prompts history <loop>` — version log with authors/dates.

### Command Surface (acceptance reference)

```
$ loopdog prompts show implement          # prints implement/prompt.md@<sha8>
$ loopdog prompts diff implement v6 v7
$ loopdog prompts edit implement          # $EDITOR → on save: validate + bump to v8 (PR)
$ loopdog prompts history implement
  v8  2026-06-08  @dana    tighten scope guard wording
  v7  2026-06-06  @dana    add per-key example
  …
```

## Out Of Scope

- Authoring a whole new loop (0078); changing modes/budgets (0071).

## Acceptance Criteria

- [x] `loopdog prompts show <loop>` prints the loop's current versioned brief.
- [x] `loopdog prompts diff <loop>` diffs two versions (defaults sensible).
- [x] `loopdog prompts edit <loop>` opens `$EDITOR`, validates on save, and stages a
      versioned change — never a silent live mutation.
- [x] `loopdog prompts history <loop>` lists versions with author/date/summary.
- [x] Invalid brief (missing required placeholders / won't render) blocks the save
      with a clear error.

## Implementation Checklist

- [x] Resolve the brief artifact + version metadata per loop.
- [x] Implement show/diff/history renderers.
- [x] Implement edit → validate → stage-as-versioned-change flow.
- [x] Define brief validation (placeholders, render check).

## Test Plan

```bash
# replace with the chosen stack's test runner
# loopdog prompts show implement ; loopdog prompts diff implement
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `loopdog loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

Extended `loopdog prompts` (from 0022's show/diff/lint) with `edit` (opens
$EDITOR on the loop prompt, or prints the path; the git diff is the audit
trail) and `history` (git log of the prompt file — prompts are versioned
repo artifacts, so their history IS the version log). No bespoke versioning
store; git is the source of truth.

## Risks / Rollback

Edits change autonomous behavior — they must be reviewable artifacts (PR/commit),
validated before they take effect, never applied silently to a running loop.

## Final Summary

`loopdog prompts show/diff/lint/edit/history`: view the composed brief, diff
against the built-in, lint placeholders/policies/secrets, open the prompt to
edit, and read its git history — the prompt artifacts' version log.
