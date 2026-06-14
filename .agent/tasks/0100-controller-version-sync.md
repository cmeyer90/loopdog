# 0100 Keep the Adopter's Controller Version in Sync

Status: verified
Branch: task/0100-controller-version-sync

## Goal

Stop an attached repo from silently running a stale (and buggy) controller after
loopdog ships a fix. Make `loopdog upgrade` re-sync the scaffolded caller
workflows' version pins to the floating major (the scaffold default), so one
upgrade converts an exact-pinned install to auto-tracking.

## Background

The controller runs in the adopter's Actions via two scaffolded caller workflows
(`loopdog-events.yml`, `loopdog-sweep.yml`) that pin both the reusable-workflow
ref (`uses: …/reusable-events.yml@<ref>`) and the CLI version (`loopdog-version:
<ref>`). loopdog is zero-infra — it cannot push updates into adopter repos — so a
caller only stays current if it **floats** (`@vN` / `loopdog-version: 'N'`, which
the release pipeline keeps moving) or is **migrated forward**.

The current template already floats (`@v0` / `'0'`), so *new* installs auto-track.
But repos scaffolded by an older (0.2.0-era) loopdog got **exact** pins
(`@<SHA>` / `0.2.0`) and nothing re-syncs them: `loopdog upgrade` only migrates
the `.loopdog/` config tree, and `loopdog init` refuses to overwrite existing
workflow files. Result (seen on `cmeyer90/looper-auto-dogfood`): the deployed
controller ran `@loopdog/cli@0.2.0` with the claim bug (`addAssignees` 403 strands
every act-mode transition), even though 0.4.0 on npm fixes it.

Relevant files:

- `packages/cli/src/commands/upgrade.ts` — the migration command (config-only today).
- `templates/workflows/loopdog-events.yml` / `loopdog-sweep.yml` — float on `@v0`.
- `scripts/sync-workflow-tags.mjs` — moves `vX`/`vX.Y.Z` tags on every publish.
- Parent: this is a follow-up to [0099](0099-cli-workflow-onoff.md) (workflow toggle).

## Scope

- Pure helper `retargetCallerWorkflow(content, major)` that rewrites a loopdog
  caller workflow's `uses: …/reusable-*.yml@<ref>` and `loopdog-version: <ref>`
  to the floating major `vN` / `'N'`, leaving everything else byte-identical.
- `loopdog upgrade` runs this over `.github/workflows/loopdog-*.yml` **regardless
  of whether the config tree needed migrating**, writes changed files (honors
  `--dry-run`), and reports what moved.

## Out Of Scope

- Touching non-loopdog workflows (only `loopdog-*.yml`, and only the reusable
  `uses:`/`loopdog-version:` lines — `loopdog-deploy.yml` is custom and untouched).
- Forcing exact-pinned users to a specific exact version: the default IS floating,
  and floating is the only durable "doesn't go stale again" outcome.
- A `loopdog status` drift warning (legacy exact pins self-heal after one upgrade,
  so transient; can be a follow-up).

## Acceptance Criteria

- [x] `retargetCallerWorkflow` converts `@<sha>`/`@v0.2.0` + `loopdog-version:
      0.2.0` to `@vN` + `loopdog-version: 'N'`; is a no-op when already floating;
      preserves owner, trailing comments, and the rest of the file.
- [x] `loopdog upgrade` re-syncs caller workflows even when the config is already
      current; `--dry-run` previews without writing; non-loopdog files untouched.
- [x] `npm run build`, `npm test`, `npm run lint` pass.
- [x] Verified on a copy/temp of the dogfood caller workflows.

## Implementation Checklist

- [ ] Add `packages/cli/src/commands/upgrade-workflows.ts` (pure helper).
- [ ] Wire it into `upgrade.ts`; restructure so the workflow sync is unconditional.
- [ ] Tests for the pure rewrite + a temp-dir command test.
- [ ] Docs: UPGRADING.md note that upgrade now re-syncs caller workflows.

## Test Plan

```bash
npm run build && npm test && npm run lint
# manual: run upgrade --dry-run against a copy of the dogfood callers
```

## Verification Log

- 2026-06-14: branched off origin/main (includes the merged 0099 workflows feature).
- 2026-06-14: `npm run build` — passed.
- 2026-06-14: `npm test` — passed, 287 tests / 40 files (+6 in
  `upgrade-workflows.test.ts`: pure-rewrite cases + temp-dir command test incl.
  dry-run + non-loopdog-untouched + missing-workflows-dir).
- 2026-06-14: `npm run lint` — passed (eslint + boundaries + prettier).
- 2026-06-14: live `loopdog upgrade --dry-run --path ~/Desktop/looper-auto-dogfood`
  on the real stale repo → would float `loopdog-events.yml` + `loopdog-sweep.yml`
  (`uses 2409590 → v0`, `loopdog-version 0.2.0 → 0`); `loopdog-deploy.yml` and the
  repo's `ci.yml` untouched; wrote nothing.

## Decisions

- Convert to the **floating major** (not a current exact pin): it matches the
  scaffold default and is the only outcome that doesn't re-stale on the next
  release. Exact pins remain a manual, documented choice.
- The sync runs unconditionally in `upgrade` (not gated by config-version drift),
  because the workflow pins drift independently of the config `version`.

## Risks / Rollback

- Rewriting an intentional exact pin to floating changes reproducibility. Mitigated:
  it matches the documented default, only runs on explicit `loopdog upgrade`, and
  is previewable with `--dry-run`. Rollback: revert the branch.

## Final Summary

`loopdog upgrade` now re-syncs the scaffolded controller workflows' version pins
to the floating major in addition to migrating the `.loopdog/` config tree. New
pure helper `retargetCallerWorkflow` (in `upgrade-workflows.ts`) rewrites the
reusable-workflow `uses:` ref and the `loopdog-version:` input to `@vN` / `'N'`,
touching only those two lines. `upgrade` runs the sync over
`.github/workflows/loopdog-*.yml` unconditionally (independent of config drift),
honors `--dry-run`, and reports each moved pin; non-loopdog files and the custom
deploy workflow are left alone. This closes the gap where a repo scaffolded by an
older loopdog (exact pins) silently ran a stale controller — one upgrade converts
it to auto-tracking, and new installs already float.

Changed files: `packages/cli/src/commands/upgrade-workflows.ts` (new),
`packages/cli/src/commands/upgrade.ts`,
`packages/cli/test/upgrade-workflows.test.ts` (new), `docs/UPGRADING.md`,
`.changeset/upgrade-syncs-controller-pins.md`.
