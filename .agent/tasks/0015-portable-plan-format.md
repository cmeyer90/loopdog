# 0015 Portable Plan Format

Status: planned  
Branch: task/0015-portable-plan-format

## Goal

Productize looper's own durable milestones+tasks system (the `.agent/` shape this
repo runs on itself) as a **portable plan format** any adopter repo can carry: a
configurable store path (default `.looper/plans/`) and the milestone + task markdown
templates looper emits. Everything-as-artifact — plain markdown/yaml in git, no
database. (Run records do NOT live here; they persist to the `looper/telemetry`
orphan branch — see 0053.)

## Background

Part of [Milestone 04](../milestones/milestone-04-durable-planning-store.md) and the
build-order step 4 `@looper/plans` package ([codebase](../../docs/codebase.md)). See
[architecture](../../docs/architecture.md) "Durable planning store (plans-as-memory)"
and "Everything-as-artifact." This task defines the *shapes* the store reads/writes;
the `PlanStore` port signatures land in 0094, issue↔plan binding in 0016, lifecycle
transitions in 0017, and index upkeep in 0018 — all of which depend on the format
fixed here. The plan store is the durable memory; GitHub is the control plane; they
never disagree. (Run records are out of scope — they live on the `looper/telemetry`
branch per 0053, not in the plan store.)

## Scope

- Define the **store layout** under a configurable root (default `.looper/plans/`):
  `milestones/`, `tasks/`, `archive/`, the two index files, and a templates source.
- Define the **milestone template** and **task template** looper emits — the same
  required sections as this repo's `.agent/` shape, parameterized for adopters.
- Add the `plan_store` config keys to root `looper.yml` (path + format version).
- A **format version stamp** + a parser/serializer for the marker blocks loops rely on
  (status, acceptance-criteria, run cross-refs) so machine edits are lossless.

### Technical detail

**Package:** `@looper/plans` (`src/format/` for templates + parse/serialize, consumed
by `src/store/`). The `PlanStore` port interface itself is in `@looper/core` (0094);
this task supplies the format the store implementation reads/writes. Config keys land
in `@looper/config`.

**Store layout** (rooted at `plan_store.path`, default `.looper/plans/`):

```
.looper/
└── plans/
    ├── milestones/milestone-NN-slug.md
    ├── tasks/NNNN-slug.md
    ├── plan-index.md          # flat, grep-friendly task index
    ├── milestones.md          # milestone roadmap + task→milestone map
    └── archive/{tasks,milestones}/  + archive/plan-index.md + archive/milestones.md
```

Run records are NOT stored here — they persist to the `looper/telemetry` orphan
branch as append-only day-bucketed NDJSON (0053).

**Config keys** (root `looper.yml`, validated by `@looper/config` zod schema):

```yaml
plan_store:
  path: .looper/plans      # configurable per adopter; default shown
  format_version: 1        # the format-version stamp; gates migrations
```

**Templates looper emits** — byte-for-byte the section set this repo enforces in
`.agent/task-template.md` / `milestone-template.md`, so the product and the dogfood
stay identical. A **task** carries: `# NNNN Title`, `Status:`, `Branch:`, `## Goal`,
`## Background`, `## Scope`, `## Out Of Scope`, `## Acceptance Criteria`,
`## Implementation Checklist`, `## Test Plan`, `## Verification Log`, `## Decisions`,
`## Risks / Rollback`, `## Final Summary`. A **milestone** carries: `# Milestone NN:
Title`, `Status:`, `## Objective`, `## Guiding Decisions`, `## Planned Tasks` (the
ID/Status/Branch/Title/Deliverable table), `## Definition Of Done`,
`## Verification Log`. These ship as `templates/plans/{task,milestone}.md` assets in
`@looper/plans` (mirroring how built-in loops ship as `templates/loops/<name>/`).

**Machine-editable marker blocks** (loops 0016/0017 must round-trip without clobbering
prose). Two parseable blocks, each an HTML comment fence so they render invisibly:

- `Status:` line — the canonical task status (one of PLANS.md status values); the
  binding loop (0016) mirrors it to the issue label and back.
- `<!-- looper:acceptance-criteria -->` … `<!-- /looper:acceptance-criteria -->` — the
  contract block of `- [ ] test: …` / `- [ ] manual: …` items (grooming writes it,
  review checks every item; see architecture "plan-as-contract").

**Parser/serializer**: `parsePlan(md) -> PlanDoc` and `serializePlan(PlanDoc) -> md`,
where `PlanDoc = { id, kind: 'task'|'milestone', status, frontMatterLines, sections:
Map<heading, body>, acceptanceCriteria?: Criterion[] }`. Edits go through
`updateSection`/`setStatus`/`checkCriterion` so loops mutate one block and
re-serialize, preserving every other byte (idempotent, diff-minimal).

**Edge cases**: missing store on first run → `looper init` (M02) scaffolds the skeleton
from templates; an adopter who set a non-default `path` → all readers resolve through
`plan_store.path`, never a hard-coded `.looper/plans`; a `format_version` newer than the
controller → refuse + tell the user to upgrade (no silent partial parse); a plan file
missing a marker block → treat as empty block, never crash.

## Out Of Scope

- Issue↔plan binding and label↔Status mirroring (0016); lifecycle open/update/archive
  transitions (0017); index auto-maintenance (0018); the `PlanStore` port signatures
  (0094); the run-record store on the `looper/telemetry` branch (0053) and writing the
  run records themselves (0012).
- Any format migration tooling beyond the version stamp + refuse-on-newer guard.

## Acceptance Criteria

- [ ] The store layout is documented and created from templates at a configurable
      root, defaulting to `.looper/plans/`.
- [ ] `templates/plans/task.md` and `templates/plans/milestone.md` ship in
      `@looper/plans` with exactly the required section set (matches PLANS.md).
- [ ] `plan_store.{path,format_version}` exist in the `looper.yml` schema and
      validate; every reader resolves paths through config, never a hard-coded path.
- [ ] `parsePlan`/`serializePlan` round-trips a plan file byte-for-byte (no marker or
      prose loss), proven by a golden round-trip test.
- [ ] `setStatus` and `checkCriterion` each mutate only their block and
      re-serialize losslessly.
- [ ] A `format_version` newer than the controller is refused with a clear message.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add `plan_store` keys to the `@looper/config` schema + defaults.
- [ ] Add `templates/plans/{task,milestone}.md` assets to `@looper/plans`.
- [ ] Implement `parsePlan`/`serializePlan` + `PlanDoc` in `@looper/plans/format`.
- [ ] Implement `setStatus`/`checkCriterion`/`updateSection` mutators.
- [ ] Implement the `format_version` stamp + refuse-on-newer guard.
- [ ] Document the layout in M04 and (briefly) in docs/architecture's plan-store note.

## Test Plan

Tests run via the repo's vitest runner; format logic is pure (no GitHub, no quota), so
no M18 fakes are needed here — behavioral plan-store IO is exercised by 0016/0017.

```bash
npm test -w @looper/plans     # round-trip + mutator golden tests
npm test -w @looper/config    # plan_store schema validation
# golden: parse->serialize a fixture plan is byte-identical; mutate one block, assert
# only that block changed; assert refuse-on-newer-format_version.
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final store layout, the chosen marker-block syntax, the `PlanDoc` shape, and
the `format_version` policy.

## Risks / Rollback

The format is a contract every plan-touching loop (0016/0017/0018) depends on, and is
written into adopter repos — a later breaking change forces a migration. Mitigate by
pinning the section set to the dogfood `.agent/` shape, stamping `format_version`, and
keeping mutators diff-minimal so machine edits stay reviewable. Rollback is removing the
unreleased `@looper/plans/format` module; no adopter data exists pre-release.

## Final Summary

Fill this in before marking verified.
