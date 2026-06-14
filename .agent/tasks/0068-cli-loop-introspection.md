# 0068 Loop Introspection (`loopdog loops list` / `loopdog loops show`)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Make every configured loop legible from the CLI: `loopdog loops list` for the
fleet, and `loopdog loops show <loop>` for one loop's config, backend, trigger,
transition, gates, the **exact brief it uses**, and the **steps it drives**.

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. The operator's first question is
"what loops exist and what does each actually do?" This command answers it by
rendering config (M02), the state machine + transition (M03), the versioned brief
artifact (M05 · 0022), gates/tiers (M09/M10), and recent telemetry (M12). Real run
stats depend on the loops + telemetry existing; the command surface and rendering
are specified and built here and degrade gracefully without telemetry.

## Scope

- `loopdog loops list` — one row per loop: mode, backend, trigger, the state it
  acts on, 24h run count, last-run age. Flags `--enabled`, `--backend <p>`,
  `--state <s>`, `--json`.
- `loopdog loops show <loop>` — full detail (see Command Surface). Flags `--brief`
  (dump the full versioned brief), `--steps` (just the step list), `--json`.
- Render purely from existing sources of truth; no new datastore.

### Command Surface (acceptance reference)

```
$ loopdog loops list
LOOP        MODE     BACKEND  TRIGGER       ACTS-ON          24H  LAST
groom       act      claude   event+sweep   needs-grooming    12  3m ago
implement   act      claude   event         ready-for-agent    4  18m ago
review      act      codex    pull_request  in-review          5  18m ago
merge       suggest  —        check_suite   verified           3  1h ago
deploy      act      claude   merge         merged             1  1h ago
dep-update  act      claude   cron:weekly   scheduled          0  6d ago

$ loopdog loops show implement
Loop: implement                                   mode: act   enabled: true
  Backend:    claude (subscription)                              # M05
  Trigger:    issue labeled `ready-for-agent` (event) + sweep    # M02
  Transition: ready-for-agent → in-progress → in-review          # M03
  Gates:      DoR required · blast-radius max_files=20 max_diff=400
  Brief:      .loopdog/loops/implement/prompt.md  (v7, edited 2d ago by @dana)
  Risk tiers: safe → eligible · core → human-gated (CODEOWNERS)
  Budget:     OK · claude routines 3/40 today                    # M12

  Steps this loop drives:
    1. claim issue (assign-bot + in-progress)          [controller]
    2. compose brief from plan + acceptance criteria    [controller]
    3. dispatch Claude routine → cloud agent            [backend]
    4. agent: implement · run tests · open PR           [work cell]
    5. ingest PR · update plan · label in-review        [controller]

  Recent: run_91c ✓  run_88a ✓  run_82f ✗(tests)   → loopdog runs list --loop implement
```

## Out Of Scope

- Run-level tracing (0069), triggering/tailing (0070), prompt editing (0072),
  authoring loops (0078).

## Acceptance Criteria

- [x] `loopdog loops list` shows all loops with mode, backend, trigger, acts-on
      state, 24h runs, last-run age; `--json` mirrors the columns.
- [x] `loopdog loops show <loop>` shows backend, trigger, transition, gates, brief
      (name + version + last edit), risk tiers, budget/quota, and the ordered
      steps the loop drives.
- [x] `loopdog loops show <loop> --brief` prints the exact versioned brief.
- [x] Unknown loop exits `2` with a helpful message; `--json` is stable.
- [x] Renders with telemetry absent (shows config + steps, omits run stats).

## Implementation Checklist

- [x] Resolve loop config + state machine + brief metadata into a view model.
- [x] Implement `list` and `show` renderers (human + `--json`).
- [x] Wire optional telemetry (run counts, recent runs) with graceful absence.
- [x] Derive the "steps this loop drives" from the loop's declared transition.

## Test Plan

```bash
# replace with the chosen stack's test runner
# loopdog loops list --json | jq . ; loopdog loops show implement --brief
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `loopdog loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

`loopdog loops list` (table + --json) and `loopdog loops show <loop>`
(config, resolved prompt SOURCE — builtin/repo/overlay — the transition step
trace, and the first 20 prompt lines with a pointer to `prompts show`). All
read from config + the prompt source; no new datastore. Shared CLI conventions
(--json everywhere, exit 2 not-found) honored.

## Risks / Rollback

Low risk (read-only). Risk: drift between displayed steps and actual runtime
behavior — derive steps from the same declaration the runner executes, not a
hand-maintained list.

## Final Summary

`loopdog loops list/show` answer what loops exist, how each is prompted, and
what its specific steps are — straight from config + the layered prompt
source, with stable --json output.
