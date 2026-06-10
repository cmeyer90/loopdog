# Milestone 01: Project Foundation & Open-Source Scaffolding

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — design tenets
> and "everything-as-artifact"; and [Codebase Layout](../../docs/codebase.md) —
> the module boundaries, filetree, and build order this milestone ratifies. This
> is looper's own repo hygiene, the floor everything else builds on.

## Objective

Stand up looper as a healthy open-source project: pick the implementation stack
and repo layout, add the licensing and community files, and make looper's own CI
+ branch protection trustworthy so the tool is itself built to the standard it
enforces on adopters.

## Guiding Decisions

- Looper builds to the standard it enforces: protected CI, CODEOWNERS on its own
  workflow/identity paths, semver from day one.
- **Stack: TypeScript on Node 20+, an npm-workspaces monorepo** of small
  `@looper/*` packages — chosen for the GitHub-App/Octokit/Actions ecosystem. The
  module boundaries, filetree, and build order are defined in
  [`docs/codebase.md`](../../docs/codebase.md); 0001 scaffolds that skeleton.
- **Modular by construction:** clean package boundaries (ports in `@looper/core`,
  impls per package), no mega-files or hero-folders, loops are data not code.
- Permissive open-source license (e.g. MIT/Apache-2.0) to maximize adoption;
  finalize in task 0002.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0001 | planned | task/0001-stack-and-repo-layout | Stack & Repo Layout | The `@looper/*` workspace skeleton per `docs/codebase.md` (8 packages, building green) + a runnable `looper --help`. |
| 0002 | planned | task/0002-license-and-community-files | License & Community Files | LICENSE, README stub, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY. |
| 0003 | planned | task/0003-own-ci-pipeline | Looper's Own CI | Green, reproducible CI (lint + test + build) on every PR. |
| 0004 | planned | task/0004-branch-protection-and-codeowners | Branch Protection & CODEOWNERS | Required checks + review; human gate on workflow/identity paths. |
| 0005 | planned | task/0005-release-and-versioning | Release & Versioning | Semver tagging + changelog + publishable artifact pipeline. |

## Definition Of Done

- The repo has the `@looper/*` workspace skeleton matching `docs/codebase.md`
  (the packages exist as buildable stubs with clean dependency edges), a runnable
  CLI, and documented dev commands (recorded in `AGENTS.md`).
- LICENSE and the standard community/health files exist.
- CI is green and reproducible; branch protection requires checks + review;
  CODEOWNERS gates looper's own workflow/identity files.
- A versioning + release process exists (even if it only ships pre-1.0 builds).

## Verification Log

Add dated entries as tasks land.
