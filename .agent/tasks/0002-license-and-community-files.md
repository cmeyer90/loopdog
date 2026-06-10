# 0002 License & Community Files

Status: verified  
Branch: claude/laughing-johnson-8a7944

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

- [x] A `LICENSE` file exists with the chosen license.
- [x] `README.md` describes looper and links to the architecture doc + roadmap.
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` exist.
- [x] License choice is recorded in Decisions.

## Implementation Checklist

- [x] Add `LICENSE` (canonical Apache-2.0 text).
- [x] Add `README.md` stub.
- [x] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
      `SECURITY.md`.

## Test Plan

```bash
# documentation-only; verify links resolve and license is recognized by GitHub
```

## Verification Log

- 2026-06-09: LICENSE fetched from apache.org canonical text (202 lines);
  CODE_OF_CONDUCT fetched from contributor-covenant.org v2.1 with the contact
  placeholder filled. README links to architecture/codebase/walkthroughs/
  roadmap resolve (paths verified). All four files present.

## Decisions

**Apache-2.0** over MIT: looper is infrastructure adopters wire into their
release pipelines — Apache-2.0's explicit patent grant and contribution terms
lower legal review friction for company adoption, at no cost to permissiveness.
Recorded in root `package.json` and each `@looper/*` package. CoC enforcement
contact routes to GitHub Security Advisories / repo owner until a maintainer
team exists.

## Risks / Rollback

Low risk. Note: changing a license after external contributions arrive is hard —
decide deliberately now.

## Final Summary

Looper is a legitimate OSS project: Apache-2.0 LICENSE (canonical text), a
README stating what looper is + status + doc links, CONTRIBUTING (dev setup,
boundaries, branches, changesets, flaky-test quarantine), Contributor Covenant
2.1, and SECURITY (private reporting, adopter trust pointers, maintainer
credential scopes).
