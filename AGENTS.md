# Repository Guidance For Agents

This file holds durable operating rules for every agent (Claude Code, Codex, or
any other tool) working in this repository. Read it before doing non-trivial
work. These rules apply across sessions and worktrees.

Use this file for durable operating rules. Use `.agent/milestones.md` for active
roadmap context and `.agent/tasks/*.md` for active task-specific plans, status,
decisions, and verification logs. Historical plans live under `.agent/archive/`.
The full planning protocol is `.agent/PLANS.md`; start with `.agent/README.md`
for orientation.

## Project

Looper is a **generic, open-source autonomous-SDLC engine you attach to any
GitHub repository.** Control loops watch a repo's issues and PRs and drive work
through the lifecycle (groom → implement → review → merge → deploy), writing
durable plans into the repo as they go. Everything project-specific is pluggable:
project adapters (build/test/deploy), model providers (Claude, Codex, …), and
secrets (bring-your-own). See [`docs/architecture.md`](docs/architecture.md) for
the full design and [`.agent/milestones.md`](.agent/milestones.md) for the V1
roadmap.

- What this repository is: the looper engine itself (the tool), not a product
  built with it.
- Runtime model: V1 runs inside the **target repo's own GitHub Actions** on the
  adopter's **Claude/Codex subscriptions** (provider cloud agents) — no API keys
  on the primary path, zero looper-hosted infrastructure.
- Stack: **TypeScript (strict) on Node 20+, an npm-workspaces monorepo** of small
  `@looper/*` packages. Module boundaries, filetree, and build order are defined
  in [`docs/codebase.md`](docs/codebase.md) (ratified by M01 · 0001).
- Standard commands (run from the repo root, Node 20+):
  - `npm install` — install workspace dependencies.
  - `npm run build` — `tsc -b` across all packages (project references enforce
    the dependency direction).
  - `npm test` — vitest over `packages/*/test` + `scripts/test`.
  - `npm run lint` — eslint + the package-boundary check
    (`scripts/check-boundaries.mjs`) + prettier `--check`.
  - `npm run format` — prettier `--write` (prettier owns code, not
    `.agent/`/`docs/` prose).
  - `node scripts/sync-plan-index.mjs` — sync task `Status` lines from
    `.agent/tasks/*.md` into the three index tables (`--check` in CI).
- Repo governance (maintainer, occasional): `npm run protect` applies
  [` .github/branch-protection.yml`](.github/branch-protection.yml) idempotently
  and read-back-verifies. It needs repo `administration:write` — the default
  Actions `GITHUB_TOKEN` does **not** have it, so run locally with `gh` auth or
  via the manually-dispatched `protect` workflow using the `ADMIN_TOKEN` repo
  secret (a maintainer PAT). This is a one-time/occasional human action, never
  part of a loop's runtime path.
- Releases: changesets two-stage pipeline
  ([`.github/workflows/release.yml`](.github/workflows/release.yml)) — push to
  `main` opens/updates a "Version Packages" PR; merging it publishes
  `@loopdog/cli` (libraries bundled in; everything else `private: true`) to npm
  with provenance and cuts the GitHub Release. Auth is **OIDC trusted
  publishing** ([`docs.npmjs.com/trusted-publishers`](https://docs.npmjs.com/trusted-publishers)) —
  no `NPM_TOKEN` secret; it needs a Trusted Publisher entry on the
  `@loopdog/cli` package naming this repo + `release.yml`, and npm ≥ 11.5.1
  (the workflow upgrades npm). OIDC can't create a new package name, so the
  first publish is a one-time manual bootstrap. Manual fallback:
  `npm run build && npx changeset publish` + `git push --follow-tags`.
- Flaky tests: quarantine with `it.skip` + `// QUARANTINE(<issue-url>): <reason>`
  and a `flaky-test` issue — never delete (see CONTRIBUTING).

Follow [`docs/codebase.md`](docs/codebase.md) for where code goes; prefer the
patterns in the nearest package and don't add new tools or cross-package coupling
without reason.

## Code Structure & Modularity

Looper is an npm-workspaces monorepo of small, single-purpose packages. See
[`docs/codebase.md`](docs/codebase.md) for the package set, dependency direction,
filetree, and build order. Rules:

- **Respect package boundaries.** Import other packages only via their public
  `index.ts`; never reach into another package's `src` internals. Port interfaces
  live in `@looper/core`; implementations live in their own package.
- **One responsibility per package and per file.** No `utils.ts`, `helpers/`,
  `common/`, or `misc/` dumping grounds — a homeless helper is a missing concept,
  not a junk drawer.
- **No mega-files, no hero-folders.** Split by concern; a file past ~300–400 lines
  or a folder past ~8–10 files is a smell to split (guideline, not a gate).
- **Loops are data, not code.** Behavior is `templates/loops/<name>/` config +
  prompts run by the generic runtime — don't add per-loop modules.
- **Production intent, pragmatic scope.** Tests colocate per package; `@looper/core`
  stays IO-free. Don't add frameworks (DI, plugin loaders, queues, a database) —
  GitHub is the store and bus — and don't over-split into micro-packages.

## Planning Workflow

For any non-trivial task, create or update a task file in `.agent/tasks/` before
implementation. Follow `.agent/PLANS.md`.

Planning should be simple, elegant, functional, and easy to maintain. A good
plan makes the next implementation obvious without becoming a second project to
manage.

When creating or updating milestones and task files:

- Keep plans complete enough to implement and verify, but no more detailed than
  the uncertainty requires.
- Prefer clear ownership, acceptance criteria, sequencing, and verification over
  long narrative.
- Avoid duplicating the same background, scope, or checklist across multiple
  files; link or reference the canonical source instead.
- Split work only when it creates reviewable implementation slices or reduces
  real risk, not to satisfy process.
- Keep task lists short enough to maintain. If a milestone needs many tasks,
  make sure each task has a distinct owner boundary and outcome.
- Archive or remove stale planning text when it stops reflecting reality.
- Treat plans as working tools: update decisions, risks, and verification when
  they change, but avoid bureaucratic churn that does not improve execution.

Before implementation:

1. Read the relevant task file.
2. Confirm or refine acceptance criteria.
3. When doing branch-based work, create a branch using the task id and slug.

During implementation:

1. Keep the task file accurate.
2. Add or update tests/checks appropriate to the blast radius.
3. Record important commands and results in the verification log.
4. Record implementation decisions in the task file, not only in chat.

Before finishing:

1. Run relevant checks.
2. Update task status.
3. Update `.agent/plan-index.md` if status changed.
4. If a task or milestone is complete, mark it complete in the task file, the
   milestone section, and the index before reporting completion.
5. Summarize changed files and verification.

## Milestones And Tasks

- A **milestone** is a durable, outcome-shaped unit of work that groups related
  tasks. It lives in `.agent/milestones/milestone-NN-slug.md` and is indexed in
  `.agent/milestones.md`.
- A **task** is one reviewable slice of a milestone (ideally one branch / one
  PR). It lives in `.agent/tasks/NNNN-slug.md` and is indexed in
  `.agent/plan-index.md`.
- Allocate the next task id by taking the highest id across
  `.agent/plan-index.md` and `.agent/archive/plan-index.md` and adding one. Task
  ids are global and zero-padded to four digits (`0001`). Milestone numbers
  increment per milestone. Ids are never reused.
- Copy `.agent/task-template.md` / `.agent/milestone-template.md` to start a new
  file; do not invent a different shape.

## Branch Naming

Use:

```text
task/NNNN-short-slug
```

Example:

```text
task/0002-cli-config-loader
```

## Task Size

Keep one task to one reviewable branch and one PR when possible.

Split work if it combines unrelated areas, has uncertain architecture, or cannot
be tested clearly in one pass.

## Done Criteria

A task is not done until:

- Acceptance criteria in the task file are satisfied.
- Relevant commands pass or failures are documented with a reason.
- The verification log lists what was actually run.
- The task file and plan index reflect the current status.
