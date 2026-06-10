# Milestone 10: Review, Verification Ladder & Merge Loop

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "The
> verification ladder" and cross-model review. Depends on Milestone 01 (trusted
> CI) and Milestone 05 (multiple providers).

## Objective

Close the loop from `in-review` to `merged` with trust built in: a verification
ladder wired to the target repo's required checks, cross-model review (reviewer ≠
implementer), an intent-diff against acceptance criteria, a fix-and-revalidate
sub-loop, and graduated auto-merge gated by risk tier.

## Guiding Decisions

- A loop never rubber-stamps its own lineage; the reviewer model differs from the
  implementer model.
- Merge authority is gated on ladder rungs 2–4 (the repo's protected checks +
  cross-model review + deploy smoke), not on agent self-tests.
- Review checks **intent** — did it deliver the plan + acceptance criteria — not
  just aesthetics.
- Graduated autonomy: `tier:safe` may auto-merge once trusted; `tier:core` stays
  human-gated via CODEOWNERS.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0041 | planned | task/0041-verification-ladder-wiring | Verification Ladder Wiring | Ladder definition bound to the adopter's required checks. |
| 0042 | planned | task/0042-cross-model-review-cell | Cross-Model Review Cell | Reviewer dispatched to a different provider than the implementer (e.g. `@codex review` on a Claude-authored PR). |
| 0043 | planned | task/0043-intent-diff-against-criteria | Intent-Diff Against Criteria | Two layers: acceptance criteria pass as executable tests (objective, rung 2) + reviewer intent-diff for the non-testable rest — each criterion met, not "it compiles." |
| 0044 | planned | task/0044-fix-suggestions-subloop | Fix-Suggestions Sub-Loop | Apply review feedback, re-run checks, re-request review. |
| 0045 | planned | task/0045-graduated-auto-merge-policy | Graduated Auto-Merge Policy | Tier-based merge authority + human gate for `tier:core`. |

## Definition Of Done

- PRs are reviewed by a provider distinct from the implementer.
- Review verifies acceptance criteria/intent; findings flow into a
  fix-and-revalidate sub-loop.
- Merge is blocked unless ladder rungs 2–4 pass.
- `tier:safe` can auto-merge under policy; `tier:core` always requires a human;
  every path is encoded.

## Verification Log

Add dated entries as tasks land.
