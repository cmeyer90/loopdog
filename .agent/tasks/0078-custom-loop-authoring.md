# 0078 Custom Loop Authoring (`loopdog loops new` questionnaire)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Let an operator add a new loop by answering a **short questionnaire**. Because a
trigger is only ever a **GitHub event or cron**, `loopdog loops new` asks a handful
of bounded questions, **generates a per-loop template folder** from them, **prints
the path**, and points the user at the brief to edit — then validates and offers a
dry-run.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. Loops are declarative and **one file
per loop** (M02): a loop lives in `.loopdog/loops/<name>/` as `loop.yml` (trigger,
transition, backend, gates) + a co-located `prompt.md` (its brief) — never a stanza
in a monolithic `loopdog.yml`. The trigger space is deliberately tiny (events +
cron), so authoring is a guided questionnaire, not a config-DSL exercise. The
generic runner (M03) executes whatever the questionnaire produces.

## Scope

- `loopdog loops new [name]` — interactive questionnaire with bounded choices:
  1. **Name** (if not given).
  2. **Trigger kind:** `cron` or `github_event` — the only two.
     - cron → pick `hourly | daily | weekly | custom (cron expr)`.
     - github_event → pick from 0008's canonical event/action matrix:
       `issues`, `issue_comment`, `pull_request`, `pull_request_review`,
       `check_run`, `check_suite`, `status`, `workflow_run`, and top-level
       `label` only for label-definition maintenance. The questionnaire then asks
       for an allowed action/predicate (for example `issues.opened`,
       `pull_request.synchronize`, `pull_request.closed[merged]`,
       `workflow_run.completed`). `push` is not a V1 loop trigger unless 0008 is
       intentionally extended.
  3. **Transition:** `from` state → `to` state (pick existing states; new states
     warn and defer to M03 · 0011).
  4. **Backend:** `claude | codex | self-hosted`.
  5. **Gates:** require CI? · risk tier (`safe | core`) · max files.
- **Generate** `.loopdog/loops/<name>/` with `loop.yml` (from answers) + `prompt.md`
  (template), default `mode: dry-run`; **print the folder path** and the
  edit/validate/preview next steps.
- `loopdog loops validate <name>` — schema + transition legality (M03) + backend
  connectivity + brief presence/placeholders.
- Non-interactive escape hatch: `--from <existing>` (clone a loop) and answer flags
  (`--trigger`, `--transition`, `--backend`, `--yes`) for scripting.

### Command Surface (acceptance reference)

```
$ loopdog loops new
? Loop name: dep-update
? Trigger:           ❯ Cron (scheduled)   ·  GitHub event
?   Schedule:        ❯ weekly  daily  hourly  custom
? Acts on (from → to): scheduled → in-review
? Backend:           ❯ claude  codex  self-hosted
? Require CI before merge? (Y/n) Y
? Risk tier:         ❯ safe  core
? Max files per change: 5

✓ Created .loopdog/loops/dep-update/
    loop.yml     ← trigger, transition, backend, gates
    prompt.md    ← edit this: tell the loop what to do      (mode: dry-run)

  Next:  open .loopdog/loops/dep-update/prompt.md and write the brief
         loopdog loops validate dep-update
         loopdog run dep-update --dry-run
```

## Out Of Scope

- Trigger kinds beyond GitHub events + cron (none are supported — that is the
  point of the narrow scope).
- Editing existing loops' prompts (0072), running/tracing loops (0070/0069),
  defining brand-new lifecycle *states* (M03 · 0011 — the questionnaire reuses
  existing states and warns on new ones).
- Any GUI; the questionnaire is terminal-only.

## Acceptance Criteria

- [x] `loopdog loops new` runs a questionnaire whose trigger choice is exactly
      `cron` or `github_event`, with bounded follow-ups for each.
- [x] The `github_event` follow-up choices are generated from 0008's canonical
      event/action matrix, including action/predicate selection and excluding
      unsupported events such as `push`.
- [x] It generates `.loopdog/loops/<name>/` containing `loop.yml` (from the answers)
      + a `prompt.md` template, defaulting to `mode: dry-run`.
- [x] It **prints the generated folder path** and the edit → validate → dry-run
      next steps.
- [x] `loopdog loops validate <name>` checks schema, transition legality, backend
      connectivity, and brief presence/placeholders, with clear per-failure errors.
- [x] Each loop is its own folder; no loop config is written into a shared
      monolithic file.
- [x] `--from <existing>` clones a loop; `--yes` + answer flags run it
      non-interactively.

## Implementation Checklist

- [x] Implement the bounded questionnaire (prompts, validation of each answer).
- [x] Implement template generation into `.loopdog/loops/<name>/` (`loop.yml` +
      `prompt.md`), default `mode: dry-run`.
- [x] Print the folder path + next-step hints.
- [x] Implement `loops validate` (schema + state machine + backend + brief).
- [x] Add the non-interactive `--from` / answer-flag path.

## Test Plan

```bash
# replace with the chosen stack's test runner
# loopdog loops new demo --trigger cron:weekly --transition scheduled:in-review --yes
# test -d .loopdog/loops/demo && loopdog loops validate demo
# loopdog loops new deploy --trigger pull_request.closed[merged] --yes → validates
# loopdog loops new bad --trigger push --yes → fails with "unsupported V1 trigger"
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `loopdog loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

`loopdog loops new` is a short questionnaire (interactive via @clack, or
flags for CI): name, trigger kind + event/schedule, from→to, backend,
expects. It validates the transition against the state machine BEFORE writing
and, when the edge isn't in the default table, emits a `declares:` block so
the custom states/edges are first-class and validated. Scaffolds
`.loopdog/loops/<name>/{loop.yml,prompt.md}`, mode inherits the dry-run
default, re-validates the tree, and points at `loopdog run <name> --dry-run`.
'Loops are data': a folder, no core change.

## Risks / Rollback

A custom loop is autonomous behavior an adopter authored — defaulting to
`mode: dry-run` and gating on `loopdog loops validate` (transition legality, gates)
keeps a mistake from acting before it's reviewed. Rollback is deleting the loop
folder.

## Final Summary

`loopdog loops new` turns the small trigger space into a questionnaire that
scaffolds a validated per-loop folder (with auto-declared custom states when
needed), dry-run by default, ready to dry-run — adding a loop touches no
loopdog code.
