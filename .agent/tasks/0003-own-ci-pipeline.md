# 0003 Looper's Own CI

Status: planned  
Branch: task/0003-own-ci-pipeline

## Goal

Give looper a green, reproducible CI pipeline (lint + test + build) on every PR,
so the tool is built to the standard it enforces on adopters.

## Background

Part of [Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md);
depends on task 0001 (stack + buildable CLI). The verification ladder looper
provides others (see [architecture](../../docs/architecture.md)) starts with CI
the agent cannot edit away — looper should hold itself to that from the start.
Branch protection + CODEOWNERS enforcement lands in task 0004.

## Scope

- Add a CI workflow running on every `pull_request`: lint, test, build.
- Make the same checks reproducible locally with documented commands.
- Establish a flaky-test quarantine convention (skip + track, never delete).

## Out Of Scope

- Branch protection and required-check enforcement (task 0004).
- Release/publish pipeline (task 0005).

## Acceptance Criteria

- [ ] CI runs lint + test + build on every PR and is green on a clean checkout.
- [ ] The same checks run locally via documented commands.
- [ ] A flaky-test quarantine convention is documented.

## Implementation Checklist

- [ ] Add `.github/workflows/ci.yml` (lint + test + build on `pull_request`).
- [ ] Document local-equivalent commands in `AGENTS.md`.
- [ ] Document the quarantine convention (where the skip list lives + tracking).

## Test Plan

```bash
# locally:
#   <lint>
#   <test>
#   <build>
# then confirm the PR workflow is green in GitHub Actions
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record CI provider (GitHub Actions), chosen lint/test/build tooling, and where the
quarantine list lives.

## Risks / Rollback

Low risk — additive. Rollback is removing the workflow. Risk: declaring CI
"trustworthy" while tests are thin; grow the suite as the engine lands.

## Final Summary

Fill this in before marking verified.
