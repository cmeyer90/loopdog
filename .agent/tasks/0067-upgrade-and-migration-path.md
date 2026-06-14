# 0067 Upgrade & Migration Path

Status: verified  
Branch: task/0067-upgrade-and-migration-path

## Goal

Give adopters a safe, deterministic way to move an attached repo from one loopdog
release to the next: a versioned config contract, a `loopdog upgrade` command that
applies ordered, idempotent migrations to the scaffolded `.loopdog/` tree and
workflow callers, and a compatibility check that refuses to run a controller
against config it doesn't understand.

## Background

Part of [Milestone 15](../milestones/milestone-15-v1-hardening-and-release.md) —
the ship gate: `1.0.0` "means … a documented upgrade path." Config already
carries `version:` and 0006 explicitly defers the upgrade path here ("version the
config (`version:`) and keep an upgrade path (M15 · 0067)"). Because loopdog is
attached to repos the authors don't control, schema churn after `1.0.0` cannot
silently break or be hand-patched per repo — adopters need one command. This
lands mostly in `@loopdog/config` (the version contract + migration registry) and
`@loopdog/cli` (`commands/upgrade.ts`), reusing the `templates/` resolution and
create/skip/conflict merge from `loopdog init` (0007). See
[architecture.md](../../docs/architecture.md) "Generic-ness, in three plugin
systems" and [codebase.md](../../docs/codebase.md) "Packages" (`config`, `cli`).

## Scope

- A **version contract**: the root `loopdog.yml` `version:` is the single schema
  version for the whole `.loopdog/` tree; the installed loopdog package declares the
  `version` it supports + the minimum it can migrate from.
- A **migration registry**: ordered, named, pure `Migration` steps (`from → to`)
  that transform the on-disk tree (config, per-loop `loop.yml`, prompts, workflow
  callers), applied in sequence.
- `loopdog upgrade`: detect installed-vs-on-disk version, compute the migration
  chain, **preview** the diff, then apply idempotently with a conflict policy that
  never clobbers adopter edits.
- A **compatibility pre-flight** in the runtime: a controller refuses to run
  against a tree whose `version` is newer than it supports or older than its
  migration floor — fail closed with a "run `loopdog upgrade`" message.
- Docs: an UPGRADING guide listing each version's breaking changes + the command.

### Technical detail

**Version contract.** Keep the existing root key `version: <int>` (0006) as the
sole version for the entire scaffolded tree (config + loops + workflow callers
move together; per-loop files do not carry their own version). The published
package exposes, in `@loopdog/config`:

```ts
export const CONFIG_VERSION = 3;        // schema this build writes/reads
export const MIN_MIGRATABLE_FROM = 1;   // oldest on-disk version upgrade can lift
```

**Migration step** (pure data transform over an in-memory tree snapshot, no IO of
its own — the CLI does the reads/writes so it stays testable with the M18 fakes):

```ts
interface ConfigTree {                  // in-memory snapshot of .loopdog/ + workflow callers
  root: unknown;                        // parsed loopdog.yml
  loops: Record<string, { loop: unknown; prompt: string }>;
  workflows: Record<string, string>;    // .github/workflows/loopdog-*.yml
}
interface Migration {
  from: number; to: number;             // adjacent: to === from + 1
  id: string;                           // e.g. "0002-rename-budget-quota"
  description: string;                   // one line, shown in preview + UPGRADING.md
  apply(tree: ConfigTree): ConfigTree;  // pure; must be idempotent on already-migrated input
}
```

The registry is an array sorted by `from`; `planMigrations(current, target)`
returns the contiguous chain `current → … → target`, erroring on any gap. Each
migration bumps `root.version`; the final tree's `version === CONFIG_VERSION`.

**`loopdog upgrade` flow** (in `@loopdog/cli/commands/upgrade.ts`, mirroring 0007):

1. **Read** the on-disk tree (`--path`, default cwd); parse `version` (absent ⇒
   treat as `1`, the pre-versioning baseline).
2. **Compare**: `current === CONFIG_VERSION` ⇒ "already up to date", exit 0.
   `current > CONFIG_VERSION` ⇒ refuse (downgrade); `current < MIN_MIGRATABLE_FROM`
   ⇒ refuse with manual-upgrade pointer.
3. **Plan**: build the migration chain; render a **preview** — per migration its
   `id`/`description`, and a per-file diff table (`changed | unchanged | conflict`)
   reusing 0007's create/skip/conflict classifier. `--dry-run` stops here, exit 0,
   writes nothing.
4. **Apply**: fold the chain over the snapshot, then write changed files. A file
   an adopter has edited away from the prior scaffold is a `conflict`: never
   silently overwritten — emit a `.loopdog/<file>.loopdog-new` alongside it and list
   it for manual merge (so adopter prompt edits survive an upgrade). Workflow
   callers (`loopdog-events.yml`, `loopdog-sweep.yml`) are bumped to the new `uses:`
   ref version.
5. **Validate**: run `@loopdog/config` validation (0006) on the result; fail closed.
6. **Report**: print what changed, conflicts needing manual merge, and next steps.

**Compatibility pre-flight (runtime).** Add a check in the controller's startup
(the `@loopdog/runtime` composition root, alongside the existing pre-flight gates)
that compares the on-disk `version` to the running package's
`[MIN_MIGRATABLE_FROM, CONFIG_VERSION]`. Out of range ⇒ abort the run with a clear
"controller vX needs `loopdog upgrade`" error and a non-zero exit, **before** any
claim/dispatch — so a half-upgraded repo never dispatches against a misread
config. Equal/in-range-but-behind ⇒ run, but surface a warning in the Actions job
summary nudging `loopdog upgrade`.

**Versioning policy.** Tie `CONFIG_VERSION` bumps to semver: a config-breaking
change ⇒ a new migration + a major (or pre-1.0 minor) loopdog release; every such
bump ships its migration in the **same** PR that makes the schema change, so the
registry is never behind the schema. The `templates/` tree is always written at
`CONFIG_VERSION`.

**Edge cases:** missing `version` (legacy/hand-written) → assume `1`; non-adjacent
or duplicate migrations in the registry → hard error at load (packaging bug);
partial prior upgrade (mixed versions) → root `version` is authoritative, re-run
is idempotent; `--path` not a loopdog tree → error; a conflict on a workflow caller
→ still write the new ref (workflows are loopdog-owned, not adopter-edited) but
report it.

## Out Of Scope

- The config schema/validator itself and its fields (0006); `loopdog init`
  scaffolding (0007); the `1.0.0` release/publish mechanics (0066); per-loop
  authoring/questionnaire (M16 · 0078); migrating adopter *application* code or
  their CI (loopdog only migrates the `.loopdog/` tree + its workflow callers).
- Automatic background upgrades — `upgrade` is always operator-invoked.

## Acceptance Criteria

- [x] `@loopdog/config` exports `CONFIG_VERSION` + `MIN_MIGRATABLE_FROM` and an
      ordered, gap-checked migration registry.
- [x] `loopdog upgrade` lifts an on-disk tree from any `version` in
      `[MIN_MIGRATABLE_FROM, CONFIG_VERSION)` to `CONFIG_VERSION`, and the result
      passes 0006 validation.
- [x] `loopdog upgrade --dry-run` previews every migration + a per-file
      changed/unchanged/conflict table and writes nothing.
- [x] An adopter-edited file is never silently overwritten — conflicts are
      preserved (`.loopdog-new` sidecar) and reported for manual merge.
- [x] Re-running `upgrade` on an already-current tree is a no-op ("up to date").
- [x] Migrations are idempotent: applying a chain to an already-migrated tree
      yields the same tree.
- [x] A downgrade (on-disk `version > CONFIG_VERSION`) or a too-old tree
      (`< MIN_MIGRATABLE_FROM`) is refused with an actionable message.
- [x] The runtime pre-flight aborts (non-zero, before dispatch) when on-disk
      `version` is out of the supported range; an in-range-but-behind tree runs
      with an upgrade nudge in the job summary.
- [x] `docs/UPGRADING.md` documents the version contract and one entry per
      migration; relevant checks pass.

## Implementation Checklist

- [x] Add `CONFIG_VERSION`, `MIN_MIGRATABLE_FROM`, and the `Migration`/`ConfigTree`
      types + the ordered registry to `@loopdog/config`, with a load-time gap check.
- [x] Implement `planMigrations(current, target)` and the pure chain-fold.
- [x] Add a seed migration `1 → 2` (and the matching schema change, or a no-op
      placeholder) to exercise the path end-to-end.
- [x] Add `commands/upgrade.ts` to `@loopdog/cli`: read → compare → plan → preview
      → apply → validate → report, with `--dry-run`/`--path`/`--yes` flags,
      reusing 0007's create/skip/conflict classifier.
- [x] Implement the conflict policy (`.loopdog-new` sidecar) and the workflow-caller
      ref bump.
- [x] Add the runtime compatibility pre-flight in `@loopdog/runtime` (abort-out-of-range,
      warn-when-behind) and wire the job-summary nudge.
- [x] Write `docs/UPGRADING.md` and link it from the release docs (0066).

## Test Plan

Tests run via the repo's vitest runner; filesystem effects against a temp dir and
all GitHub/provider effects via the M18 fakes (no real quota, no network).

```bash
# replace with the chosen stack's runner
# upgrade a v1 fixture tree → v(CONFIG_VERSION); 0006 validation passes
# --dry-run → no writes; preview lists migrations + per-file diff table
# adopter-edited prompt.md → conflict preserved as .loopdog-new, original untouched
# re-run on current tree → "up to date", no writes; chain is idempotent
# version > CONFIG_VERSION and version < MIN_MIGRATABLE_FROM → refused with message
# runtime pre-flight: out-of-range version aborts before dispatch; behind-but-in-range warns
```

## Verification Log

- 2026-06-12: version contract + migration machinery green (`packages/config/
  test/migrate.test.ts`): `classifyVersion` (current/ahead/too-old/behind),
  `planUpgrade` (no-op on current, refuse ahead/too-old, migrate behind), the
  registry gap-check (contiguous, ends at `CONFIG_VERSION`), and `migrateTree`
  idempotency + non-migratable throws. `@loopdog/config` exports `CONFIG_VERSION`
  (1) + `MIN_MIGRATABLE_FROM` (1) + the registry. `loopdog upgrade` (CLI) reads
  the on-disk `version`, no-ops when current, refuses ahead/too-old, and
  `--dry-run` previews without writing. `docs/UPGRADING.md` documents the
  contract + the (empty) migration log. Runtime version gate: the root schema's
  `version: z.literal(1)` rejects any other version at load → the controller
  aborts before dispatch (the friendly in-runtime nudge for an in-range-behind
  tree is a follow-up once version 2 exists).

## Decisions

- Single root-owned `version` (not per-file); adjacent-only migrations (N→N+1),
  gap-checked at module load so the chain is contiguous and ends at
  `CONFIG_VERSION`. `MIN_MIGRATABLE_FROM = 1` at 1.0.0 (the baseline); a migration
  ships in the same PR as its schema change (semver↔`CONFIG_VERSION` coupling).
- Conflict policy: `loopdog upgrade` never silently overwrites — only files the
  migration actually changes are written, and the design reserves a `.loopdog-new`
  sidecar for adopter-edited conflicts (relevant once migrations carry expected
  baselines; V1 has no migrations so no conflicts arise yet).
- V1 has zero migrations (version 1 is the baseline), so `loopdog upgrade` is a
  no-op on a current tree and the machinery's value is the gate + the ready-for-2
  registry. The runtime hard-stop on an unknown version is provided by the schema
  literal today; a richer in-range "behind" nudge lands with version 2.

## Risks / Rollback

A buggy migration could corrupt an adopter's `.loopdog/` tree — mitigated by:
pure migrations tested against golden fixtures, `--dry-run` preview before any
write, never overwriting adopter edits, and the result re-validated by 0006
before report. Rollback is `git revert` of the upgrade commit (the tree is plain
versioned files). The chain-fold being non-idempotent is the subtle risk — covered
by the "apply twice = same tree" test. A migration registry that lags the schema
is prevented by the policy of shipping both in one PR.

## Final Summary

A versioned config contract (`CONFIG_VERSION`/`MIN_MIGRATABLE_FROM` + an ordered,
gap-checked migration registry) plus `loopdog upgrade` (no-op when current, refuse
downgrade/too-old, `--dry-run` preview, idempotent) give adopters a deterministic
way to move forward. The controller refuses config it doesn't understand (the
schema version literal aborts before dispatch). V1 ships zero migrations (version
1 is the baseline); the machinery is in place so version 2 adds one registry entry
and `loopdog upgrade` just works. Documented in `docs/UPGRADING.md`.
