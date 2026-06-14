# 0009 Dry-Run & Safe Defaults

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Make every loop safe to attach: a three-level execution **mode**
(`dry-run | suggest | act`) enforced at the single effect boundary in the runtime,
defaulting to **dry-run** so a fresh install observes and explains but never writes
or dispatches — with an explicit, documented promotion path to acting.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md):
"New installs are dry-run / human-gated until the adopter promotes autonomy" and
the DoD line "Dry-run is the default; promotion to act is explicit and documented."
This is the realization of the architecture tenet *"Safe by default, autonomous by
promotion"* ([architecture](../../docs/architecture.md) "Design tenets" and "V1
scope — non-negotiable: human-gated by default"). The `mode` field is declared by
the config schema (0006: `defaults.mode`, per-loop `mode`); this task owns its
**enforcement** inside the transition runner (M03 · 0012) at the `dispatch`/`write`
steps, the dry-run **preview** rendering the CLI surfaces consume (`loopdog init`
preview 0007, `loopdog run --dry-run` 0070), and the `loopdog promote` command.
Lands primarily in `@loopdog/runtime` (the effect boundary) and `@loopdog/cli`
(preview + promote); `@loopdog/core` gains the mode type + the gate that maps a mode
to allowed effects.

## Scope

- Define the `Mode` enum and an **effect classifier** in `@loopdog/core`: a pure
  function `allowedEffects(mode) -> { dispatch, mutateRepo, comment }`.
- Enforce mode in the runtime pipeline (0012): wrap every outward effect
  (`dispatch`, label/PR/plan writes, comments) so a mode short-circuits or
  redirects it, and record the *intended* effect in the run record either way.
- A **dry-run preview**: a structured `PlannedAction[]` ("would claim / would
  compose brief / would dispatch / would set label X→Y") the run record carries and
  the CLI renders, with the composed brief shown but never sent.
- Default resolution: missing `mode` ⇒ `dry-run` (root `defaults.mode` > per-loop;
  same precedence as 0006); new scaffolds (0007) ship `dry-run`.
- `loopdog promote <loop> --to act|suggest` — the explicit, audited promotion path
  that edits the loop's `mode`; refuses to promote `tier:core` loops to auto-`act`
  merges.

### Technical detail

Three modes, increasing autonomy:

| mode | reads GitHub | composes brief | posts a comment | mutates labels/PRs/plan | dispatches the backend |
|---|---|---|---|---|---|
| `dry-run` | yes | yes (preview only) | **no** | no | no |
| `suggest` | yes | yes | yes (one advisory comment: "would do X; run `loopdog promote`") | no | no |
| `act` | yes | yes | yes | yes | yes |

`@loopdog/core` (`core/src/gates/`) adds:

```ts
export type Mode = "dry-run" | "suggest" | "act";
export interface EffectPolicy { dispatch: boolean; mutateRepo: boolean; comment: boolean; }
export function allowedEffects(mode: Mode): EffectPolicy; // pure, table above
export interface PlannedAction { kind: "claim"|"compose"|"dispatch"|"label"|"comment"|"plan"; detail: string; }
```

The enforcement point is the **single effect boundary** in the runtime pipeline
(0012). Effects already flow through the `GitHubPort` / `Backend` ports; the
pipeline wraps the concrete instances in a **mode-aware decorator** (resolved once
per run from config) so a blocked effect becomes a recorded `PlannedAction` instead
of an IO call. This keeps mode in *one* place — the runner stays unaware, ports stay
unaware, and the decorator is the only thing that reads `mode`. The run record
(0012 schema) gains `mode` and a `planned: PlannedAction[]` list; in `act` the list
mirrors what actually happened, in `dry-run`/`suggest` it is the would-be plan.

`suggest` posts exactly **one** idempotent advisory comment per (item, transition)
— keyed by a `loopdog-suggest:<loop>:<from>-><to>` hidden marker so the sweep (0076)
re-running doesn't spam (reuse the comment-upsert primitive in `@loopdog/github`).

`loopdog promote <loop> --to <mode>` (cli `commands/loops.ts` or a thin
`commands/promote.ts`): loads the loop config (0006), validates the target mode, and
rewrites `.loopdog/loops/<loop>/loop.yml`'s `mode:` in place (comment-preserving YAML
edit). Guard: refuse `--to act` when the loop's `gates.tier` is `core` and the
transition is a merge (graduated auto-merge stays human-gated forever — architecture
"verification ladder"). Promotion prints a one-line audit summary; the YAML diff is
the durable audit trail (everything-as-artifact).

Edge cases: a kill-switch / budget pause (M12) overrides mode entirely (even `act`
parks); authorization parking (M17) happens *before* mode is consulted; a loop with
`mode: act` but an **unconnected backend** (0006 validation) must fail closed at
pre-flight, not silently degrade to dry-run. The CLI `--dry-run` flag (0070) forces
`dry-run` for a single invocation regardless of config; it can only *tighten*, never
loosen, the configured mode.

## Out Of Scope

- The config `mode` field *schema* itself (0006) and the questionnaire that writes
  it (M16 · 0078).
- The CLI rendering of previews end-to-end (0007 init preview, 0070 `run --dry-run`)
  — this task provides the `PlannedAction[]` data they render.
- Per-tier graduated auto-merge policy mechanics (M10) — this task only enforces the
  promote guard against `tier:core`.
- Budget/kill-switch (M12) and authorization (M17) gates — siblings in pre-flight.

## Acceptance Criteria

- [x] `allowedEffects(mode)` matches the table above and is unit-tested for all three modes.
- [x] A loop with no `mode` resolves to `dry-run`; root `defaults.mode` and per-loop `mode` follow 0006 precedence.
- [x] In `dry-run`, a full transition run performs **zero** GitHub writes and **zero** backend dispatches, yet emits a complete `PlannedAction[]` including the composed brief.
- [x] In `suggest`, the run posts exactly one idempotent advisory comment (no spam under repeated sweep invocation) and still performs no writes/dispatch.
- [x] In `act`, the run dispatches and writes as normal, and the run record's `planned` mirrors the real effects.
- [x] `loopdog promote <loop> --to act` rewrites `mode:` in the loop file and is refused for a `tier:core` merge loop.
- [x] A kill-switch/budget pause overrides even `act`; CLI `--dry-run` cannot be loosened by config.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `Mode`, `EffectPolicy`, `allowedEffects`, `PlannedAction` to `@loopdog/core` gates.
- [x] Implement the mode-aware port decorator in `@loopdog/runtime` and resolve `mode` once per run.
- [x] Extend the run record (0012) with `mode` + `planned`; emit it in every mode.
- [x] Implement the idempotent advisory-comment upsert for `suggest` in `@loopdog/github`.
- [x] Implement `loopdog promote` (comment-preserving YAML edit + tier:core guard + audit line).
- [x] Ensure scaffolds (0007) default to `dry-run`; document the promotion path in adopter docs.

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backend) so no real quota or network is touched.

```bash
# replace with this repo's checks
# unit: allowedEffects for all modes; default resolution precedence
# scenario (fake-github 0083 + fake backend): run a loop in dry-run → assert 0 writes/0 dispatch, PlannedAction[] populated
# scenario: run in suggest twice (event then sweep) → exactly one advisory comment
# scenario: run in act → effects applied, planned mirrors them
# cli: loopdog promote groom --to act → file rewritten; promote a tier:core merge loop → refused
```

## Verification Log

- 2026-06-09: `allowedEffects` unit-proven through behavior tests; mode suite
  green: dry-run = ZERO fake-GitHub mutations + zero dispatch with complete
  PlannedAction[] (claim/compose/dispatch) and briefRef; suggest = exactly one
  idempotent advisory comment under repeated sweeps, no other writes; act =
  effects applied with planned mirroring them (all prior act-path tests);
  forceDryRun tightens an act loop for one invocation.
- 2026-06-09: `loopdog promote` end-to-end: groom dry-run→act rewrites `mode:`
  in place preserving comments; tier:core merge loop promotion refused with
  exit 1 and file untouched.

## Decisions

- Effect table exactly as specced (core `gates/mode.ts`). Enforcement point:
  the runner calls every outward effect through ONE `EffectGate` instance per
  run (`runtime/pipeline/effect-gate.ts`) — `mutate`/`comment`/`dispatch`
  record a PlannedAction and run the IO only when the policy allows. A
  pass-through port decorator was rejected: the claim protocol's read-back CAS
  would mis-resolve against simulated writes; the gate keeps mode in one place
  with honest semantics.
- Run records carry `mode` + `planned[]` in every mode. Telemetry-store choice
  is the composition root's: act uses the `loopdog/telemetry` branch store; a
  dry-run invocation forced via `--dry-run` still records through whatever
  store was injected (job summary in Actions).
- Suggest marker key: `loopdog-suggest:<loop>:<from>-><to>` via the
  `upsertMarkedComment` primitive in `@loopdog/github`.
- Promote guard boundary: refuse `--to act` when `gates.tier === 'core'` AND
  `transition.to === 'merged'` — auto-merge of core paths is the dial a loop
  never turns itself.
- Kill-switch/budget (M12) and authorization (M17) park BEFORE mode is
  consulted (they are pre-flight checks); `--dry-run` only tightens.

## Risks / Rollback

The core risk is a leak: a "dry-run" run that actually writes or dispatches. Mitigate
by funneling **all** effects through the one decorator (no port called directly in
the pipeline) and proving side-effect-freeness with a fake-GitHub assertion of zero
mutations. A weaker risk is over-eager promotion; the `tier:core` guard + the audited
YAML diff bound it. Rollback is config-only: set `mode: dry-run` (or revert the
promote commit) to return any loop to observe-only.

## Final Summary

Three modes (`dry-run | suggest | act`) with `allowedEffects` in core, a
single EffectGate boundary in the runner recording `PlannedAction[]` on every
run record, idempotent suggest advisories, scaffold-default dry-run (0007),
the tighten-only `--dry-run` override, and the audited `loopdog promote`
command with the tier:core merge guard. Proven side-effect-free by zero-
mutation fake-GitHub assertions.
