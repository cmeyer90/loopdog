# 0102 Document the SemVer Changeset-Bump Policy

Status: verified
Branch: task/0102-semver-bump-policy

## Goal

Stop churning version numbers by writing down — and pointing every contributor
(human and agent) at — how to choose a changeset bump under SemVer, especially
the pre-1.0 convention.

## Background

Recent PRs each shipped a `minor` changeset for ordinary backwards-compatible
additions, so the version climbed fast (0.4 → phantom 0.5 → 0.6) and toward 1.0
with no stated policy. `CONTRIBUTING.md` says "pick bump level" but never says
how. The repo's [release-checklist](../../docs/release-checklist.md) already
treats `1.0.0` as a deliberate gate cut with a single `major` changeset — and
changesets does NOT remap `major`→`minor` for 0.x, so a casual `major` jumps
straight to 1.0.0. The correct pre-1.0 policy therefore is: `patch` for any
backwards-compatible change, `minor` only for breaking changes, `major` reserved
for the 1.0 gate.

This is docs-only (a durable operating rule) — no code, no changeset.

## Scope

- Add a "Choosing the bump (SemVer)" subsection to `CONTRIBUTING.md` with a
  pre-1.0 vs post-1.0 table and rules of thumb.
- Add a one-line bump-policy pointer to the `AGENTS.md` Releases bullet so agents
  follow it when authoring changesets.

## Out Of Scope

- Reclaiming the skipped 0.5.0 (phantom from a merge race) or rewriting in-flight
  release PR #19 — the policy is forward-looking ("from here on out").
- CI enforcement of bump correctness (it's a human judgment; can revisit later).

## Acceptance Criteria

- [x] `CONTRIBUTING.md` states the SemVer policy: default `patch` pre-1.0,
      `minor` only for breaking, `major` only for the 1.0 gate; docs/tests/internal
      → no changeset.
- [x] `AGENTS.md` Releases bullet references the policy.
- [x] `npm run lint` passes (prettier ignores docs, so this is the boundary/eslint
      no-op check); no changeset added (policy demonstrated).

## Implementation Checklist

- [ ] CONTRIBUTING.md subsection + table.
- [ ] AGENTS.md pointer line.
- [ ] Task file + plan-index entry.

## Test Plan

```bash
npm run lint   # docs-only; confirms nothing else regressed
```

## Verification Log

- 2026-06-14: branched off origin/main.
- 2026-06-14: `npm run lint` — passed (eslint + boundaries + prettier; docs are
  prettier-ignored, so this confirms nothing else regressed).
- 2026-06-14: no changeset added — this PR is docs-only, demonstrating the policy.

## Decisions

- Pre-1.0 mapping (Convention A): `patch` = backwards-compatible (features, fixes,
  new commands/flags that don't break anyone); `minor` = breaking; `major` = the
  deliberate 1.0.0. Chosen because changesets sends any `major` straight to 1.0.0
  and the release-checklist already defines 1.0 as a gated, intentional release.
- Docs-only change → no changeset (and this PR follows that rule).

## Risks / Rollback

- None material; documentation only. Rollback: revert the branch.

## Final Summary

Documented the SemVer changeset-bump policy. `CONTRIBUTING.md` gained a "Choosing
the bump (SemVer)" subsection — a pre-1.0 vs post-1.0 table plus rules of thumb:
default to `patch` for any backwards-compatible change, `minor` only for breaking
changes, `major` reserved for the deliberate 1.0.0 gate, and no changeset for
docs/tests/internal. `AGENTS.md` gained a one-line bump-policy pointer so agents
follow it too. Forward-looking (does not reclaim the skipped 0.5.0). Docs-only →
no changeset, which is itself an instance of the policy.

Changed files: `CONTRIBUTING.md`, `AGENTS.md`,
`.agent/tasks/0102-semver-bump-policy.md`, `.agent/plan-index.md`.
