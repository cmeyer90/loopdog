# 0015 Portable Plan Format

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Productize loopdog's own durable milestones+tasks system (the `.agent/` shape this
repo runs on itself) as a **portable plan format** any adopter repo can carry: a
configurable store path (default `.loopdog/plans/`) and the milestone + task markdown
templates loopdog emits. Everything-as-artifact — plain markdown/yaml in git, no
database. (Run records do NOT live here; they persist to the `loopdog/telemetry`
orphan branch — see 0053.)

## Background

Part of [Milestone 04](../milestones/milestone-04-durable-planning-store.md) and the
build-order step 4 `@loopdog/plans` package ([codebase](../../docs/codebase.md)). See
[architecture](../../docs/architecture.md) "Durable planning store (plans-as-memory)"
and "Everything-as-artifact." This task defines the *shapes* the store reads/writes;
the `PlanStore` port signatures land in 0094, issue↔plan binding in 0016, lifecycle
transitions in 0017, and index upkeep in 0018 — all of which depend on the format
fixed here. The plan store is the durable memory; GitHub is the control plane; they
never disagree. (Run records are out of scope — they live on the `loopdog/telemetry`
branch per 0053, not in the plan store.)

## Scope

- Define the **store layout** under a configurable root (default `.loopdog/plans/`):
  `milestones/`, `tasks/`, `archive/`, the two index files, and a templates source.
- Define the **milestone template** and **task template** loopdog emits — the same
  required sections as this repo's `.agent/` shape, parameterized for adopters.
- Add the `plan_store` config keys to root `loopdog.yml` (path + format version).
- A **format version stamp** + a parser/serializer for the marker blocks loops rely on
  (status, acceptance-criteria, run cross-refs) so machine edits are lossless.

### Technical detail

**Package:** `@loopdog/plans` (`src/format/` for templates + parse/serialize, consumed
by `src/store/`). The `PlanStore` port interface itself is in `@loopdog/core` (0094);
this task supplies the format the store implementation reads/writes. Config keys land
in `@loopdog/config`.

**Store layout** (rooted at `plan_store.path`, default `.loopdog/plans/`):

```
.loopdog/
└── plans/
    ├── milestones/milestone-NN-slug.md
    ├── tasks/NNNN-slug.md
    ├── plan-index.md          # flat, grep-friendly task index
    ├── milestones.md          # milestone roadmap + task→milestone map
    └── archive/{tasks,milestones}/  + archive/plan-index.md + archive/milestones.md
```

Run records are NOT stored here — they persist to the `loopdog/telemetry` orphan
branch as append-only day-bucketed NDJSON (0053).

**Config keys** (root `loopdog.yml`, validated by `@loopdog/config` zod schema):

```yaml
plan_store:
  path: .loopdog/plans      # configurable per adopter; default shown
  format_version: 1        # the format-version stamp; gates migrations
```

**Templates loopdog emits** — byte-for-byte the section set this repo enforces in
`.agent/task-template.md` / `milestone-template.md`, so the product and the dogfood
stay identical. A **task** carries: `# NNNN Title`, `Status:`, `Branch:`, `## Goal`,
`## Background`, `## Scope`, `## Out Of Scope`, `## Acceptance Criteria`,
`## Implementation Checklist`, `## Test Plan`, `## Verification Log`, `## Decisions`,
`## Risks / Rollback`, `## Final Summary`. A **milestone** carries: `# Milestone NN:
Title`, `Status:`, `## Objective`, `## Guiding Decisions`, `## Planned Tasks` (the
ID/Status/Branch/Title/Deliverable table), `## Definition Of Done`,
`## Verification Log`. These ship as `templates/plans/{task,milestone}.md` assets in
`@loopdog/plans` (mirroring how built-in loops ship as `templates/loops/<name>/`).

**Machine-editable marker blocks** (loops 0016/0017 must round-trip without clobbering
prose). Two parseable blocks, each an HTML comment fence so they render invisibly:

- `Status:` line — the canonical task status (one of PLANS.md status values); the
  binding loop (0016) mirrors it to the issue label and back.
- `<!-- loopdog:acceptance-criteria -->` … `<!-- /loopdog:acceptance-criteria -->` — the
  contract block of `- [x] test: …` / `- [x] manual: …` items (grooming writes it,
  review checks every item; see architecture "plan-as-contract").

**Parser/serializer**: `parsePlan(md) -> PlanDoc` and `serializePlan(PlanDoc) -> md`,
where `PlanDoc = { id, kind: 'task'|'milestone', status, frontMatterLines, sections:
Map<heading, body>, acceptanceCriteria?: Criterion[] }`. Edits go through
`updateSection`/`setStatus`/`checkCriterion` so loops mutate one block and
re-serialize, preserving every other byte (idempotent, diff-minimal).

**Edge cases**: missing store on first run → `loopdog init` (M02) scaffolds the skeleton
from templates; an adopter who set a non-default `path` → all readers resolve through
`plan_store.path`, never a hard-coded `.loopdog/plans`; a `format_version` newer than the
controller → refuse + tell the user to upgrade (no silent partial parse); a plan file
missing a marker block → treat as empty block, never crash.

## Out Of Scope

- Issue↔plan binding and label↔Status mirroring (0016); lifecycle open/update/archive
  transitions (0017); index auto-maintenance (0018); the `PlanStore` port signatures
  (0094); the run-record store on the `loopdog/telemetry` branch (0053) and writing the
  run records themselves (0012).
- Any format migration tooling beyond the version stamp + refuse-on-newer guard.

## Acceptance Criteria

- [x] The store layout is documented and created from templates at a configurable
      root, defaulting to `.loopdog/plans/`.
- [x] `templates/plans/task.md` and `templates/plans/milestone.md` ship in
      `@loopdog/plans` with exactly the required section set (matches PLANS.md).
- [x] `plan_store.{path,format_version}` exist in the `loopdog.yml` schema and
      validate; every reader resolves paths through config, never a hard-coded path.
- [x] `parsePlan`/`serializePlan` round-trips a plan file byte-for-byte (no marker or
      prose loss), proven by a golden round-trip test.
- [x] `setStatus` and `checkCriterion` each mutate only their block and
      re-serialize losslessly.
- [x] A `format_version` newer than the controller is refused with a clear message.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `plan_store` keys to the `@loopdog/config` schema + defaults.
- [x] Add `templates/plans/{task,milestone}.md` assets to `@loopdog/plans`.
- [x] Implement `parsePlan`/`serializePlan` + `PlanDoc` in `@loopdog/plans/format`.
- [x] Implement `setStatus`/`checkCriterion`/`updateSection` mutators.
- [x] Implement the `format_version` stamp + refuse-on-newer guard.
- [x] Document the layout in M04 and (briefly) in docs/architecture's plan-store note.

## Test Plan

Tests run via the repo's vitest runner; format logic is pure (no GitHub, no quota), so
no M18 fakes are needed here — behavioral plan-store IO is exercised by 0016/0017.

```bash
npm test -w @loopdog/plans     # round-trip + mutator golden tests
npm test -w @loopdog/config    # plan_store schema validation
# golden: parse->serialize a fixture plan is byte-identical; mutate one block, assert
# only that block changed; assert refuse-on-newer-format_version.
```

## Verification Log

- 2026-06-09: format suite green (6 tests): byte-for-byte round-trip (task +
  milestone), header/section parsing, single-block mutators (setStatus,
  checkItem, appendToSection, setHeaderField), template-asset drift guard,
  refuse-on-newer format_version.
- 2026-06-09: `plan_store` schema (path + format_version, string shorthand
  accepted) validated by the config suite; the controller asserts the version
  before any plan IO.

## Decisions

- Store layout exactly as specced under `plan_store.path` (default
  `.loopdog/plans/`): tasks/, milestones/, archive/{tasks,milestones}/, the two
  index files + archive indexes. Run records stay on `loopdog/telemetry` (0053).
- Marker blocks: the `Status:` header line + the shared
  `<!-- loopdog:acceptance-criteria -->` fence (parser lives in core 0014 and is
  reused verbatim — one parser, no drift).
- `PlanDoc` = {kind, id, title, status, headerLines (raw), sections (ordered,
  raw bodies)} — deliberately line-preserving rather than AST-based, so
  serialize(parse(x)) === x and machine edits are diff-minimal.
- Templates are EMBEDDED as code (the bundled CLI must carry them) with
  `packages/plans/templates/*.md` as the reviewable assets and a drift-guard
  test asserting byte equality.
- `format_version: 1`; newer-than-supported refuses with upgrade guidance
  (fail closed, no partial parse).

## Risks / Rollback

The format is a contract every plan-touching loop (0016/0017/0018) depends on, and is
written into adopter repos — a later breaking change forces a migration. Mitigate by
pinning the section set to the dogfood `.agent/` shape, stamping `format_version`, and
keeping mutators diff-minimal so machine edits stay reviewable. Rollback is removing the
unreleased `@loopdog/plans/format` module; no adopter data exists pre-release.

## Final Summary

`@loopdog/plans/format`: the portable plan shape (this repo's own `.agent/`
section set, parameterized), a lossless line-preserving parser/serializer with
single-block mutators, embedded+asset templates with a drift guard, the store
layout constants, and the format_version gate. `plan_store.{path,format_version}`
ship in the config schema with a string shorthand.
