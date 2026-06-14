# 0095 CLI `ldg` Shorthand & 0.2.0 Publish

Status: implemented
Branch: claude/amazing-goldberg-0926da

## Goal

Make the CLI invokable as both `loopdog` and the shorthand `ldg`, and ship it to
npm as `@loopdog/cli@0.2.0` when this lands on `main`.

## Scope

- `packages/cli/package.json`: add a second `bin` entry `"ldg": "dist/main.js"`
  alongside the existing `loopdog` entry. Both resolve to the same executable, so
  `ldg <cmd>` is a drop-in alias for `loopdog <cmd>`. The Commander program keeps
  its canonical `.name('loopdog')` (help text shows `loopdog` under either alias),
  so `program.test.ts` is unaffected.
- Bump every `@loopdog/*` package (fixed-version line) and the private root from
  `0.1.0` → `0.2.0`, updating internal `@loopdog/*` dependency pins to match so
  workspace linking stays exact.

## Release decision (non-obvious)

This is a **direct version bump, not a changeset.** The two-stage changeset flow
([release.yml](../../.github/workflows/release.yml)) would only open a "Version
Packages" PR on merge and publish on a *second* merge. A direct bump with no
pending changeset means the `changesets/action` finds nothing to version and runs
`npm run release` → `changeset publish`, which publishes any version not yet on
the registry — so a single merge to `main` publishes `0.2.0`. That single-merge
publish is the intended outcome here.

## Acceptance criteria

- `npm install -g @loopdog/cli` (or a local link) exposes both `loopdog` and `ldg`.
- All ten manifests report `0.2.0`; no `0.1.0` pins remain.
- On merge to `main`, the release workflow publishes `@loopdog/cli@0.2.0`.
