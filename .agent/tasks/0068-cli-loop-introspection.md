# 0068 Loop Introspection (`looper loops list` / `looper loops show`)

Status: planned  
Branch: task/0068-cli-loop-introspection

## Goal

Make every configured loop legible from the CLI: `looper loops list` for the
fleet, and `looper loops show <loop>` for one loop's config, backend, trigger,
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

- `looper loops list` — one row per loop: mode, backend, trigger, the state it
  acts on, 24h run count, last-run age. Flags `--enabled`, `--backend <p>`,
  `--state <s>`, `--json`.
- `looper loops show <loop>` — full detail (see Command Surface). Flags `--brief`
  (dump the full versioned brief), `--steps` (just the step list), `--json`.
- Render purely from existing sources of truth; no new datastore.

### Command Surface (acceptance reference)

```
$ looper loops list
LOOP        MODE     BACKEND  TRIGGER       ACTS-ON          24H  LAST
groom       act      claude   event+sweep   needs-grooming    12  3m ago
implement   act      claude   event         ready-for-agent    4  18m ago
review      act      codex    pull_request  in-review          5  18m ago
merge       suggest  —        check_suite   verified           3  1h ago
deploy      act      claude   merge         merged             1  1h ago
dep-update  act      claude   cron:weekly   scheduled          0  6d ago

$ looper loops show implement
Loop: implement                                   mode: act   enabled: true
  Backend:    claude (subscription)                              # M05
  Trigger:    issue labeled `ready-for-agent` (event) + sweep    # M02
  Transition: ready-for-agent → in-progress → in-review          # M03
  Gates:      DoR required · blast-radius max_files=20 max_diff=400
  Brief:      .looper/loops/implement/prompt.md  (v7, edited 2d ago by @dana)
  Risk tiers: safe → eligible · core → human-gated (CODEOWNERS)
  Budget:     OK · claude routines 3/40 today                    # M12

  Steps this loop drives:
    1. claim issue (assign-bot + in-progress)          [controller]
    2. compose brief from plan + acceptance criteria    [controller]
    3. dispatch Claude routine → cloud agent            [backend]
    4. agent: implement · run tests · open PR           [work cell]
    5. ingest PR · update plan · label in-review        [controller]

  Recent: run_91c ✓  run_88a ✓  run_82f ✗(tests)   → looper runs list --loop implement
```

## Out Of Scope

- Run-level tracing (0069), triggering/tailing (0070), prompt editing (0072),
  authoring loops (0078).

## Acceptance Criteria

- [ ] `looper loops list` shows all loops with mode, backend, trigger, acts-on
      state, 24h runs, last-run age; `--json` mirrors the columns.
- [ ] `looper loops show <loop>` shows backend, trigger, transition, gates, brief
      (name + version + last edit), risk tiers, budget/quota, and the ordered
      steps the loop drives.
- [ ] `looper loops show <loop> --brief` prints the exact versioned brief.
- [ ] Unknown loop exits `2` with a helpful message; `--json` is stable.
- [ ] Renders with telemetry absent (shows config + steps, omits run stats).

## Implementation Checklist

- [ ] Resolve loop config + state machine + brief metadata into a view model.
- [ ] Implement `list` and `show` renderers (human + `--json`).
- [ ] Wire optional telemetry (run counts, recent runs) with graceful absence.
- [ ] Derive the "steps this loop drives" from the loop's declared transition.

## Test Plan

```bash
# replace with the chosen stack's test runner
# looper loops list --json | jq . ; looper loops show implement --brief
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record column choices, the view-model shape, and how steps are derived from the
declared transition.

## Risks / Rollback

Low risk (read-only). Risk: drift between displayed steps and actual runtime
behavior — derive steps from the same declaration the runner executes, not a
hand-maintained list.

## Final Summary

Fill this in before marking verified.
