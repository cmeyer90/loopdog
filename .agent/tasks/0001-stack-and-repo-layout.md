# 0001 Stack & Repo Layout

Status: planned  
Branch: task/0001-stack-and-repo-layout

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

- [ ] The `@looper/*` workspace skeleton matches `docs/codebase.md` (8 packages,
      correct dependency direction); `npm run build` is green across the workspace.
- [ ] Dependency boundaries are enforced (a cross-package internal import fails
      lint/build), and `@looper/core` has no IO dependencies.
- [ ] `looper --help` builds and runs locally from `@looper/cli`.
- [ ] `AGENTS.md` "Project" lists the real install/build/test/lint commands.

## Implementation Checklist

- [ ] `git init` + initial commit.
- [ ] Set up npm workspaces + `tsconfig.base.json` + lint/format + test runner.
- [ ] Create the 8 packages as buildable stubs (barrel `index.ts` + `test/`).
- [ ] Enforce dependency direction (e.g. import/no-internal-modules or project
      references); keep `core` IO-free.
- [ ] Add `looper --help` in `@looper/cli`; create empty `templates/`.
- [ ] Update `AGENTS.md` "Project" with real commands.

## Test Plan

```bash
# after scaffolding, the real commands replace these:
#   <build command>
#   <run> looper --help
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Stack decided in [`docs/codebase.md`](../../docs/codebase.md): TypeScript on
Node 20+, npm-workspaces monorepo (rationale: GitHub-App/Octokit/Actions
ecosystem). Record here the finalized tooling picks (build/test/lint/CLI/schema
libraries) and the dependency-enforcement mechanism.

## Risks / Rollback

Low risk — greenfield scaffolding. Main risk is letting the skeleton drift from
`docs/codebase.md` (boundaries erode silently); enforce dependency direction in
tooling from day one so violations fail the build, not review.

## Final Summary

Fill this in before marking verified.
