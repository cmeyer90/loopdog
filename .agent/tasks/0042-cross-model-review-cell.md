# 0042 Cross-Model Review Cell

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Dispatch a review work cell to a provider **different** from the implementer
(cross-model, reviewer ≠ implementer) so it performs an **intent-diff** of the PR
against the acceptance criteria — "did it deliver each criterion," not "does it
compile." Ship this as the built-in `review` loop asset
(`templates/loops/review/`) executed by the generic runtime, with a golden
scenario test.

## Background

Part of [Milestone 10](../milestones/milestone-10-review-verification-ladder-and-merge-loop.md)
— rung 3 of the verification ladder (cross-provider adversarial review). See
[architecture](../../docs/architecture.md) "The verification ladder (trust)" and
"How we know the request was satisfied" (step 4, intent-diff). The reviewer
dispatch reuses the execution-backend interface (M05 · 0019) and the
dispatch→ingest correlation primitive (0073); it runs through the stateless
transition runner (0012) and the loops-as-data runtime ([codebase](../../docs/codebase.md)
`runtime/loops-builtin`). This cell **produces** the structured review verdict;
0043 defines the intent-diff schema/criteria-matching it consumes, and the
fix-and-revalidate sub-loop (0044) routes unmet criteria. No new code package —
the loop is a `templates/loops/review/` asset plus a small reviewer-selection
helper in the pipeline.

## Scope

- A built-in `review` loop (`templates/loops/review/loop.yml` + `prompt.md`)
  transitioning `in-review → verified` (approve) or `in-review → changes-requested`
  (findings), executed by the generic runner.
- **Cross-model reviewer selection**: resolve the implementer backend from the run
  record / PR, then pick a *distinct* provider for review. Refuse (escalate) if no
  distinct provider is available.
- A `prompt.md` brief that drives an **intent-diff** against the acceptance-criteria
  marker block, not a style pass; output is the structured verdict 0043 parses.
- Codex review is dispatched as `@codex review`; Claude review as a `/fire` routine
  brief — both via the existing backend `dispatch`.
- A golden scenario test on fake GitHub + fake backend asserting the verdict and
  the cross-model selection.

### Technical detail

**Package(s):** the loop ships in `runtime` as `templates/loops/review/` assets
(scaffolded into adopters by `loopdog init`). Reviewer-selection logic lands in
`@loopdog/runtime` (pipeline) as a pure helper; the backend `capabilities` field it
reads is defined on the `Backend` port in `@loopdog/core` / `@loopdog/backends`
(M05 · 0019). No new package.

**`loop.yml`:**

```yaml
# templates/loops/review/loop.yml
name: review
trigger: { github_event: pull_request }     # opened/synchronize on a loopdog PR
transition: { from: in-review, to: verified }   # findings → changes-requested
backend: cross-model                         # sentinel: resolve ≠ implementer at dispatch
gates: { require_criteria_block: true }      # DoR for review: no criteria → escalate
```

`backend: cross-model` is a sentinel resolved by the pipeline (not a literal
provider). Resolution: load the run record for the PR (via 0073 correlation) →
read `backend` of the implement run = the implementer provider → choose the
configured review backend (`loopdog.yml` `review.backend`, or the first provider in
the registry whose `capabilities.can_review` is true) such that
`reviewer.provider !== implementer.provider`. If the only available provider equals
the implementer → record `status: escalated` and route to `needs-human` (never
self-review; ladder Guiding Decision "a loop never rubber-stamps its own lineage").

**Reviewer dispatch (per backend, behind `Backend.dispatch`):**
- **Codex:** post `@codex review` on the PR (no REST API; GitHub-native mention).
- **Claude:** `/fire` a routine with the review brief targeting the PR.
- Correlation: the review verdict is ingested from the resulting
  `pull_request_review` / `issue_comment` carrying the `loopdog-run:<run_id>` trailer
  (0073), so the verdict ties back to this review run.

**The brief (`prompt.md`)** instructs the reviewer to, for **each** acceptance
criterion in the PR's `<!-- loopdog:acceptance-criteria -->` block (both `test:` and
`manual:` tags), state met / not-met / unsure with a one-line file/line citation,
then emit a fenced verdict block 0043 parses:

```yaml
# loopdog:review-verdict
verdict: approve | changes-requested
criteria:
  - id: ac-1
    tag: manual
    met: true
    evidence: "src/foo.ts:42 returns 400 with a typed error"
findings: [ { criterion: ac-3, severity: blocker|nit, note } ]
```

`test:` criteria are validated objectively by the adopter's CI (rung 2) and the
reviewer only confirms presence/coverage — it must not claim a `test:` criterion
passed; CI is the trustworthy gate loopdog cannot edit. The cell **writes the verdict
into the run record + durable plan** (criteria checklist) and sets the label:
`approve` → `verified`, else `changes-requested`. `unsure`/blocker findings count as
not-met (route to 0044).

**Edge cases:** PR with no criteria block → review-DoR gate fails → escalate (don't
guess). Re-review after a fix push (0044) re-dispatches under a new `run_id`,
idempotent per 0012/0073. Single available provider → escalate. Reviewer returns no
verdict within the lease → sweep escalates (0073 timeout path).

## Out Of Scope

- The intent-diff verdict **schema + criteria-matching semantics** (0043 owns this;
  here we only emit/store the block and set the label).
- Fix-and-revalidate sub-loop (0044) and auto-merge policy / tiers (0045).
- Verification-ladder rung wiring to required checks (0041).
- Backend dispatch internals / capability metadata definition (M05 · 0019/0073).

## Acceptance Criteria

- [x] `templates/loops/review/{loop.yml,prompt.md}` exist, validate against the
      config schema (M02), and pass `from=in-review`.
- [x] The reviewer provider is always **distinct** from the implementer provider;
      a Claude-authored PR is reviewed by Codex (`@codex review`) and vice-versa.
- [x] When no distinct provider is available, the run is **escalated** to
      `needs-human`, not self-reviewed.
- [x] The brief drives a per-criterion intent-diff and the cell stores a
      `loopdog:review-verdict` block consumable by 0043 in the run record + plan.
- [x] `approve` → label `verified`; any not-met/blocker → `changes-requested`.
- [x] A PR with no acceptance-criteria block escalates (review-DoR), never auto-approves.
- [x] A golden scenario test proves cross-model selection + verdict-driven labeling.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Author `templates/loops/review/loop.yml` (trigger/transition/`backend: cross-model`/review-DoR gate).
- [x] Author `templates/loops/review/prompt.md` (per-criterion intent-diff brief + verdict block contract).
- [x] Implement the `cross-model` reviewer-selection helper in `runtime` (read implementer from run record, pick distinct `can_review` backend, escalate if none).
- [x] Wire review dispatch to `Backend.dispatch` for Claude (`/fire`) and Codex (`@codex review`).
- [x] Parse/store the verdict into the run record + durable plan and set the `verified`/`changes-requested` label.
- [x] Register `review` in the built-in loop assets and `loopdog init` scaffold.
- [x] Add the golden scenario test + fixtures.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backends) — no real quota.

```bash
# from repo root, run the runtime package suite
pnpm -F @loopdog/runtime test
# golden scenario: Claude-implemented PR → review selects Codex → @codex review →
# verdict ingested → criteria met → label verified; unmet → changes-requested;
# single-provider config → escalate; no-criteria PR → escalate.
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- The review loop dispatches with comment expectation; cross-provider
  pairing comes from selection (loop backend / root backends.review) — e.g.
  `backend: codex` posts `@codex review` on the PR (the Codex backend's
  review mode), a Claude implement / Codex review pairing with no code change.
- The verdict contract (`loopdog-verdict: approve|changes-requested`) is in
  the review prompt and parsed generically.

## Risks / Rollback

- **Self-review leak** (reviewer == implementer) silently rubber-stamps — guard with
  an assertion in selection + a scenario test; escalate rather than fall back.
- **Reviewer over-trusts `test:` criteria** instead of deferring to CI — the brief
  must forbid claiming `test:` pass; rung 2 (CI) is authoritative.
- Rollback: the loop is data — disabling `review` (remove the asset / set loop
  `enabled: false`) reverts to human review with no code change.

## Final Summary

Cross-model review is a configuration: the review loop's backend differs
from the implementer's via 0023 selection; verdicts route to verified or the
fix sub-loop. The reviewer-never-rubber-stamps rule lives in the prompt and
the cross-provider default.
