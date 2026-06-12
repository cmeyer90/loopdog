# 0038 Blast-Radius & Scope Guards

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Bound how much a single implementation run is allowed to change: a deterministic
`max_files`/`max_diff` guard that, when a provider-opened PR exceeds the loop's
declared blast radius, **halts and escalates** the item to a human instead of
letting the change balloon and auto-flow toward merge.

## Background

Part of [Milestone 09](../milestones/milestone-09-implementation-loop.md), whose
Guiding Decisions require: "Enforces blast-radius limits (max files / max diff);
scope-exceeding work halts and escalates instead of ballooning." See
[architecture](../../docs/architecture.md) — "The loops" (Implementation:
"Enforces blast-radius limits; scope-exceeding work halts and escalates") and the
loop config shape `blast_radius: { max_files: 5 }`. The guard is a pure predicate
in `@looper/core` (alongside the DoR/DoD gates, M03 · 0014), evaluated by the
`@looper/runtime` pipeline at **ingest** time (M05 · 0073) on the diff the
provider cloud agent produced — looper makes no model call. Escalation reuses the
stuck/escalation path (M12 · 0051) and the resilience `escalate_to` target (M19).

## Scope

- A `blast_radius` predicate: given a PR diff summary + the loop's limits, decide
  `within` vs `exceeded` with a structured reason.
- Config: extend the per-loop `loop.yml` schema (`@looper/config`) with
  `blast_radius: { max_files, max_diff, exempt }`, with a repo-wide default in
  `looper.yml` (strictest of repo-wide vs per-loop wins).
- Wire the guard into the implementation pipeline at ingest: a PR that exceeds
  limits halts the transition (does **not** advance to `in-review`), labels the
  item, comments the reason, and escalates.
- Advisory pre-dispatch surfacing of the limits into the composed brief so the
  agent is told the budget up front (best-effort; the objective gate is at ingest).

### Technical detail

**Lands in:** predicate + types in `@looper/core` (`core/src/gates/`, sibling to
the DoR/DoD gates 0014); schema in `@looper/config`; wiring in
`@looper/runtime/src/pipeline`; the diff summary is read via the existing
`GitHubPort` (`@looper/github`, PR files/additions/deletions — no new port).

**Config types** (`@looper/config` schema, zod):

```yaml
# loop.yml (per-loop) — also settable repo-wide in looper.yml as defaults
blast_radius:
  max_files: 5            # changed files (added+modified+removed)
  max_diff: 400           # added+deleted lines across the PR
  exempt:                 # globs excluded from BOTH counts (lockfiles, generated)
    - "**/package-lock.json"
    - "**/__snapshots__/**"
```

`BlastRadiusLimits = { maxFiles?: number; maxDiff?: number; exempt: string[] }`.
Absent limit = unbounded for that dimension. Effective limits = element-wise
`min(repoWide, perLoop)` for the numeric knobs; `exempt` globs are unioned.

**Predicate** (pure, IO-free, in `core`):

```ts
type DiffSummary = { files: { path: string; added: number; deleted: number }[] };
type BlastRadiusVerdict =
  | { status: "within"; files: number; diff: number }
  | { status: "exceeded"; files: number; diff: number;
      limits: BlastRadiusLimits; breached: ("files" | "diff")[] };

function checkBlastRadius(diff: DiffSummary, limits: BlastRadiusLimits): BlastRadiusVerdict;
```

Algorithm: drop files matching any `exempt` glob (use `minimatch`/`picomatch`),
then `files = remaining.length`, `diff = Σ(added+deleted)` over remaining. Breach
if `maxFiles != null && files > maxFiles` or `maxDiff != null && diff > maxDiff`.
The verdict lists every breached dimension (so the escalation message names both
if both are over).

**Pipeline wiring (ingest, runtime):** after 0073 correlates the PR to the run and
before advancing the label to the `to` state, the runner fetches the PR diff
summary, runs `checkBlastRadius`. On `exceeded`: do **not** set `looper:state/in-review`;
instead set `looper:needs-human` (the loop's escalation off-ramp), apply a
`looper:scope-exceeded` marker label, post a single comment quoting the breached
limits + actuals + the exempted-paths note, append a `gate` step to the run record
with `outcome.status: escalated`, and hand off via the escalation path (M12 · 0051)
to the resilience `escalate_to` target. On `within`: proceed normally.

**Idempotency:** the guard runs inside the idempotent ingest (0073); re-ingesting
an already-escalated PR is a no-op (guard on the `looper:scope-exceeded` label /
existing escalation comment), consistent with the runner's single-step guarantee
(0012). The guard is **fail-closed**: if the diff can't be read, treat as a gate
failure and escalate rather than silently advance.

**Pre-dispatch advisory:** the brief composer injects the effective `max_files`/
`max_diff` into `prompt.md` rendering so the agent knows the budget; this is
guidance only — the agent cannot edit away the objective ingest-time gate.

**Edge cases:** PR with only exempt-file changes → `files: 0`, `within`. Renames
counted once (path-after). A loop with no `blast_radius` and no repo default →
unbounded (no gate; emit no comment). Binary files → counted as 1 file, 0 diff
lines (GitHub reports no line counts) — `max_files` still applies.

## Out Of Scope

- The escalation/backoff mechanics themselves (M12 · 0051) and the resilience
  policy taxonomy (M19) — this task only emits the escalate signal.
- Correlation/ingest plumbing (M05 · 0073) — this consumes it.
- DoR/DoD criteria gates (M03 · 0014) — sibling gate, separate predicate.
- Splitting/auto-shrinking an oversized PR — out of V1; escalate, don't re-plan.

## Acceptance Criteria

- [x] `checkBlastRadius` returns `within` when files+diff are under limits and
      `exceeded` (naming each breached dimension) when over, with `exempt` globs
      excluded from both counts.
- [x] Effective limits = strictest of repo-wide (`looper.yml`) and per-loop
      (`loop.yml`); an absent dimension is treated as unbounded.
- [x] At ingest, an over-budget PR does **not** advance to `in-review`; it lands in
      `needs-human` with `looper:scope-exceeded`, a single explanatory comment, and
      a run-record `gate` step marked `escalated`.
- [x] Re-ingesting an already-escalated PR is a no-op (idempotent).
- [x] The guard is fail-closed: an unreadable diff escalates, never advances.
- [x] `loop.yml`/`looper.yml` `blast_radius` config validates via the `@looper/config`
      schema; invalid values are rejected by `looper loops validate`.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `BlastRadiusLimits`/`DiffSummary`/`BlastRadiusVerdict` types + `checkBlastRadius`
      in `@looper/core/src/gates`.
- [x] Extend the `@looper/config` loop + root schema with `blast_radius` and the
      strictest-wins merge of repo-wide + per-loop limits.
- [x] Read the PR diff summary via `GitHubPort` and wire the guard into the
      ingest step of the implementation pipeline (`@looper/runtime`).
- [x] Implement the exceeded path: label + comment + run-record step + escalation
      handoff (M12 · 0051), idempotent and fail-closed.
- [x] Inject effective limits into the composed brief (advisory).
- [x] Update the built-in implement loop template (`templates/loops/implement/loop.yml`)
      with a sensible default `blast_radius` and document the knobs.

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backend) — no real quota.

```bash
# unit: checkBlastRadius — under/at/over limits, exempt globs, strictest-wins merge,
#       both-dimensions-breached, binary/rename edge cases (core, IO-free)
# scenario: dispatch → fake provider opens an over-budget PR → ingest lands the item
#           in needs-human + looper:scope-exceeded, does NOT reach in-review;
#           a within-budget PR advances normally
# simulation: re-deliver the same over-budget PR event → single escalation (idempotent);
#             unreadable diff → fail-closed escalation
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- Enforcement point: INGEST (the earliest the controller sees the diff).
  checkBlastRadius (loop-actions.ts) checks changedFiles vs max_files,
  additions+deletions vs max_diff, and forbidden_paths globs.
- On violation: the item is NOT advanced — looper:needs-human + an explanatory
  comment (split the work or widen limits consciously) + claim release +
  an escalated run record carrying the PR number. The PR survives for human
  review; nothing merges.

## Risks / Rollback

A too-tight default blast radius escalates legitimate work and stalls the loop;
a too-loose one defeats the guard. Ship conservative defaults on the built-in
implement loop, make limits per-loop tunable via the CLI, and keep the guard
advisory-in-brief + objective-at-ingest so tuning never requires touching core.
Rollback: removing `blast_radius` from a loop disables the gate for that loop
(unbounded) without code changes — "loops are data."

## Final Summary

Blast-radius limits are enforced at ingest with halt-and-escalate semantics
(never advance, never silently truncate); per-loop limits inherit root
defaults. Proven by the e2e blast-radius scenario (max_files 2 vs a 14-file
PR).
