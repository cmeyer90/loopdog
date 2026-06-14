# 0003 Loopdog's Own CI

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Give loopdog a green, reproducible CI pipeline (lint + test + build) on every PR,
so the tool is built to the standard it enforces on adopters.

## Background

Part of [Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md);
depends on task 0001 (stack + buildable CLI). The verification ladder loopdog
provides others (see [architecture](../../docs/architecture.md)) starts with CI
the agent cannot edit away — loopdog should hold itself to that from the start.
Branch protection + CODEOWNERS enforcement lands in task 0004.

## Scope

- Add a CI workflow running on every `pull_request`: lint, test, build.
- Make the same checks reproducible locally with documented commands.
- Establish a flaky-test quarantine convention (skip + track, never delete).

## Out Of Scope

- Branch protection and required-check enforcement (task 0004).
- Release/publish pipeline (task 0005).

## Acceptance Criteria

- [x] CI runs lint + test + build on every PR and is green on a clean checkout.
      (Workflow added; local clean-checkout equivalent verified — green. First
      live Actions run will occur when this branch gets a PR.)
- [x] The same checks run locally via documented commands.
- [x] A flaky-test quarantine convention is documented.

## Implementation Checklist

- [x] Add `.github/workflows/ci.yml` (lint + test + build on `pull_request`
      and `push` to main).
- [x] Document local-equivalent commands in `AGENTS.md`.
- [x] Document the quarantine convention (CONTRIBUTING "Flaky tests": `it.skip`
      + `QUARANTINE(<issue-url>)` comment + `flaky-test` issue; greppable).

## Test Plan

```bash
# locally:
#   <lint>
#   <test>
#   <build>
# then confirm the PR workflow is green in GitHub Actions
```

## Verification Log

- 2026-06-09: local equivalents of all three CI jobs green from a clean state:
  `npm ci`-equivalent install, `npm run lint`, `npm test`, `npm run build` +
  `node packages/cli/dist/main.js --help` smoke.

## Decisions

- CI provider: GitHub Actions; jobs named exactly `lint`, `test`, `build` — the
  names are required-check contexts in `.github/branch-protection.yml` (0004),
  so renames must touch both files (a comment in ci.yml says so).
- Tooling per 0001 decisions (eslint 9 + boundary script + prettier; vitest 3;
  tsc -b). Node 20 in CI (the engines floor).
- Quarantine list = grep for `QUARANTINE(` in test files; tracking = GitHub
  issues labeled `flaky-test`. No separate skip-list file to drift.

## Risks / Rollback

Low risk — additive. Rollback is removing the workflow. Risk: declaring CI
"trustworthy" while tests are thin; grow the suite as the engine lands.

## Final Summary

Added `.github/workflows/ci.yml` running the three repo-standard checks (lint
incl. boundary check, vitest, tsc build + CLI smoke) on every PR and push to
main, with npm caching. Local commands documented in `AGENTS.md`; quarantine
convention in CONTRIBUTING. Job names are stable contexts consumed by 0004.
