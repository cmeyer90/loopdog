# 0002 License & Community Files

Status: planned  
Branch: task/0002-license-and-community-files

## Goal

Make looper a legitimate open-source project by adding the license and the
standard community/health files.

## Background

Part of [Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md).
Looper is intended to be adopted broadly, so a permissive license and clear
contribution/security policy lower the barrier to adoption and contribution. See
[architecture](../../docs/architecture.md) (design tenets).

## Scope

- Choose and add a permissive `LICENSE` (e.g. MIT or Apache-2.0) — record the
  choice and rationale.
- Add a `README.md` stub (what looper is, status, link to docs/architecture).
- Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.

## Out Of Scope

- The full docs site and quickstart (Milestone 14).
- The published security & trust model / threat doc (Milestone 14, task 0062).

## Acceptance Criteria

- [ ] A `LICENSE` file exists with the chosen license.
- [ ] `README.md` describes looper and links to the architecture doc + roadmap.
- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` exist.
- [ ] License choice is recorded in Decisions.

## Implementation Checklist

- [ ] Add `LICENSE`.
- [ ] Add `README.md` stub.
- [ ] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.

## Test Plan

```bash
# documentation-only; verify links resolve and license is recognized by GitHub
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the license choice (MIT vs Apache-2.0 etc.) and why.

## Risks / Rollback

Low risk. Note: changing a license after external contributions arrive is hard —
decide deliberately now.

## Final Summary

Fill this in before marking verified.
