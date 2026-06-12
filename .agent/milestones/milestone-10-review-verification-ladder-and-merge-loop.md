# Milestone 10: Review, Verification Ladder & Merge Loop

Status: verified

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
| 0041 | verified | task/0041-verification-ladder-wiring | Verification Ladder Wiring | Ladder definition bound to the adopter's required checks. |
| 0042 | verified | task/0042-cross-model-review-cell | Cross-Model Review Cell | Reviewer dispatched to a different provider than the implementer (e.g. `@codex review` on a Claude-authored PR). |
| 0043 | verified | task/0043-intent-diff-against-criteria | Intent-Diff Against Criteria | Two layers: acceptance criteria pass as executable tests (objective, rung 2) + reviewer intent-diff for the non-testable rest — each criterion met, not "it compiles." |
| 0044 | verified | task/0044-fix-suggestions-subloop | Fix-Suggestions Sub-Loop | Apply review feedback, re-run checks, re-request review. |
| 0045 | verified | task/0045-graduated-auto-merge-policy | Graduated Auto-Merge Policy | Tier-based merge authority + human gate for `tier:core`. |

## Definition Of Done

- [x] PRs are reviewed by a provider distinct from the implementer (selection:
  loop backend / root backends.review — config, zero code).
- [x] Review verifies criteria/intent (the intent-diff prompt + verdict
  contract); changes-requested findings flow into the fix loop on the SAME PR
  (updated-after-dispatch correlation).
- [x] Merge is DoD-blocked: required checks green + standing approval + every
  criterion attested; blocked merges comment their reasons.
- [x] tier:safe may be promoted to auto-merge; tier:core merge loops can NEVER
  be promoted to act (the promote guard) — every path encoded + tested.

## Verification Log
- 2026-06-09: all tasks verified offline: the loops e2e suite drives the real
  scaffolded templates on fakes through the full lifecycle (169 tests green
  repo-wide). Live provider behavior remains the M00 operator item.
