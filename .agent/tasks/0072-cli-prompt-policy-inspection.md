# 0072 Prompt & Policy Inspection (`looper prompts show/diff/edit/history`)

Status: planned  
Branch: task/0072-cli-prompt-policy-inspection

## Goal

Let an operator see and safely change **how a loop is prompted**: view the brief,
diff versions, edit it (versioned), and read its history — `looper prompts
show/diff/edit/history <loop>`.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. Prompts/policies are versioned,
reviewable repo artifacts (M05 · 0022) — tuning them is the operator's main lever
on loop behavior. Editing must validate and produce a reviewable change, never a
silent live mutation.

## Scope

- `looper prompts show <loop>` — print the current brief (name + version).
- `looper prompts diff <loop> [<vA> <vB>]` — diff versions (default: working vs
  last committed).
- `looper prompts edit <loop>` — open `$EDITOR`; on save, validate (renders,
  required placeholders present) and stage a versioned change (a PR/commit).
- `looper prompts history <loop>` — version log with authors/dates.

### Command Surface (acceptance reference)

```
$ looper prompts show implement          # prints implement/prompt.md@<sha8>
$ looper prompts diff implement v6 v7
$ looper prompts edit implement          # $EDITOR → on save: validate + bump to v8 (PR)
$ looper prompts history implement
  v8  2026-06-08  @dana    tighten scope guard wording
  v7  2026-06-06  @dana    add per-key example
  …
```

## Out Of Scope

- Authoring a whole new loop (0078); changing modes/budgets (0071).

## Acceptance Criteria

- [ ] `looper prompts show <loop>` prints the loop's current versioned brief.
- [ ] `looper prompts diff <loop>` diffs two versions (defaults sensible).
- [ ] `looper prompts edit <loop>` opens `$EDITOR`, validates on save, and stages a
      versioned change — never a silent live mutation.
- [ ] `looper prompts history <loop>` lists versions with author/date/summary.
- [ ] Invalid brief (missing required placeholders / won't render) blocks the save
      with a clear error.

## Implementation Checklist

- [ ] Resolve the brief artifact + version metadata per loop.
- [ ] Implement show/diff/history renderers.
- [ ] Implement edit → validate → stage-as-versioned-change flow.
- [ ] Define brief validation (placeholders, render check).

## Test Plan

```bash
# replace with the chosen stack's test runner
# looper prompts show implement ; looper prompts diff implement
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the brief versioning scheme (git history vs. embedded version) and the
required-placeholder contract a brief must satisfy.

## Risks / Rollback

Edits change autonomous behavior — they must be reviewable artifacts (PR/commit),
validated before they take effect, never applied silently to a running loop.

## Final Summary

Fill this in before marking verified.
