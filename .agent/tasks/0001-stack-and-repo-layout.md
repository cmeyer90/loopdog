# 0001 Stack & Repo Layout

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Scaffold looper's monorepo skeleton — the `@looper/*` workspace packages per
[`docs/codebase.md`](../../docs/codebase.md) — and land a buildable, runnable
`looper --help`, so every later milestone has clean module boundaries to fill in.

## Background

First task of [Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md)
and the whole V1 roadmap. The stack and module layout are **decided** in
[`docs/codebase.md`](../../docs/codebase.md): TypeScript (strict) on Node 20+, an
npm-workspaces monorepo of ~8 small `@looper/*` packages with one-way dependency
edges (ports in `core`, impls per package). This task stands that skeleton up; it
does not implement behavior. The repo is not yet a git repository.

## Scope

- Initialize the npm-workspaces monorepo + base TypeScript/lint/test config.
- Create the 8 `@looper/*` packages from `docs/codebase.md` as **buildable stubs**
  (each: `package.json`, `src/index.ts` barrel, `test/`) with the correct
  dependency edges enforced (no cross-package internal imports).
- Land a runnable `looper --help` in `@looper/cli`.
- Add `templates/` (empty homes for the scaffold assets `looper init` will emit).
- Record dev commands in `AGENTS.md` "Project".

## Out Of Scope

- The config schema and `looper init` behavior (Milestone 02).
- Any loop, adapter, or provider implementation.
- License/community files (task 0002) and CI (task 0003).

## Acceptance Criteria

- [x] The `@looper/*` workspace skeleton matches `docs/codebase.md` (8 packages
      + dev-only `@looper/testing`, correct dependency direction); `npm run build`
      is green across the workspace.
- [x] Dependency boundaries are enforced (a cross-package internal import fails
      lint/build), and `@looper/core` has no IO dependencies.
- [x] `looper --help` builds and runs locally from `@looper/cli`.
- [x] `AGENTS.md` "Project" lists the real install/build/test/lint commands.

## Implementation Checklist

- [x] ~~`git init` + initial commit~~ (repo already existed with an initial commit).
- [x] Set up npm workspaces + `tsconfig.base.json` + lint/format + test runner.
- [x] Create the 9 packages as buildable stubs (barrel `index.ts` + `test/`).
- [x] Enforce dependency direction (TS project references + eslint
      `no-restricted-imports` on `@looper/*/*` + `scripts/check-boundaries.mjs`
      edge table in `npm run lint`); `core` is IO-free (no dependencies).
- [x] Add `looper --help` in `@looper/cli`; create empty `templates/`.
- [x] Update `AGENTS.md` "Project" with real commands.

## Test Plan

```bash
# after scaffolding, the real commands replace these:
#   <build command>
#   <run> looper --help
```

## Verification Log

- 2026-06-09: `npm install` — clean, 0 vulnerabilities (registry reachable).
- 2026-06-09: `npm run build` (tsc -b, 9 composite packages) — green.
- 2026-06-09: `node packages/cli/dist/main.js --help` — prints usage; `--version` → 0.1.0.
- 2026-06-09: `npm test` — green (cli smoke tests).
- 2026-06-09: `npm run lint` — eslint + `check-boundaries.mjs` ("package
  boundaries OK") + prettier check all green.

## Decisions

Stack decided in [`docs/codebase.md`](../../docs/codebase.md): TypeScript on
Node 20+, npm-workspaces monorepo. Finalized tooling (pinned to known-stable
majors deliberately; current latest majors — TS 6, eslint 10, vitest 4, zod 4,
commander 15 — were skipped to avoid unvetted breaking changes at scaffold time):

- Build: `tsc -b` with **project references** (`composite: true`), ESM
  (`module: NodeNext`), TypeScript ~5.9. `tsup ^8` bundles only the published CLI.
- Tests: `vitest ^3` at the root, aliasing each `@looper/*` barrel to its
  `src/index.ts` (tests run without a build step), tests colocated per package.
- Lint/format: `eslint ^9` flat config + `typescript-eslint ^8`; `prettier ^3`
  scoped to code (`.agent/`, `docs/`, `spikes/`, `*.md` excluded).
- CLI: `commander ^13`; questionnaire UX: `@clack/prompts ^0.11`.
- Schemas: `zod ^3`; YAML: `yaml ^2`. GitHub: `@octokit/rest ^21` +
  `@octokit/auth-oauth-device ^8`.
- Dependency-direction enforcement is three-layered: TS project references
  (build order), eslint `no-restricted-imports` (`@looper/*/*` deep imports),
  and `scripts/check-boundaries.mjs` (the allowed-edge table from
  `docs/codebase.md`, run in `npm run lint`).
- `@looper/testing` added alongside the 8 shipped packages (dev-only,
  `private: true`), per the codebase doc.

## Risks / Rollback

Low risk — greenfield scaffolding. Main risk is letting the skeleton drift from
`docs/codebase.md` (boundaries erode silently); enforce dependency direction in
tooling from day one so violations fail the build, not review.

## Final Summary

Scaffolded the npm-workspaces monorepo: 9 `@looper/*` packages (core, config,
github, plans, backends, adapters, runtime, cli, testing) as buildable ESM
stubs with strict TS project references matching `docs/codebase.md`'s edge
table, three-layer boundary enforcement, vitest source-aliased tests, and a
runnable `looper --help`/`--version` in `@looper/cli`. All four standard
commands documented in `AGENTS.md` and green locally.
