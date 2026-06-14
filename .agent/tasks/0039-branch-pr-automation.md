# 0039 Branch/PR Automation

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Own the branch + PR lifecycle for the implementation loop: instruct the dispatched
work cell to branch and open its PR on the conventions loopdog can correlate, post
the **plan-as-contract** onto the issue/PR, and — on ingest — normalize the PR
(labels, body trailer, plan link, issue linkage) into the `in-review` state. No git
push by loopdog itself: the provider's cloud agent creates the branch and PR; loopdog
specifies the shape and reconciles the result.

## Background

Part of [Milestone 09](../milestones/milestone-09-implementation-loop.md)
(Implementation Loop). The milestone row for 0039 is *Branch/PR Automation —
"Branch creation, PR open, plan-contract posting."* On the primary path loopdog makes
no direct model API call: the agent clones, branches, and opens the PR in the
provider sandbox (architecture "Execution model"; "The loops" → Implementation), so
this task is the **brief-side contract** for branch/PR shape plus the **ingest-side
normalization** that lands the PR as a correlated, contract-bearing `in-review` item.
It sits between the dispatch/ingest correlation primitive (0073) and the runner
(0012), and reuses the `GitHubPort` PR/label/comment surface in `@loopdog/github`.

## Scope

- Define the canonical **branch name** and **PR shape** (title, body, trailer,
  issue ref) the brief instructs the agent to produce, aligned with 0073's
  three-signal correlation.
- Compose the **plan-as-contract** comment/body block from the durable plan and the
  `<!-- loopdog:acceptance-criteria -->` marker, and post it on the issue (at claim)
  and reconcile it onto the PR (at ingest).
- On ingest, **normalize** the PR: set the `loopdog:state/in-review` label, ensure the
  `loopdog-run:` trailer + `Closes #<issue>` linkage exist, link the plan, and (when
  open as draft) mark ready-for-review per loop policy.
- Idempotent across event + sweep re-invocation: re-posting/normalizing is a no-op.

### Technical detail

**Lands in:** `@loopdog/runtime` (the implementation-loop pipeline step + the
plan-contract composer live with `pipeline/` and the built-in `loops-builtin/`
assets), calling the PR/label/comment methods on `GitHubPort` in `@loopdog/github`.
Branch/trailer string constants are shared with correlation (0073) — keep them in
`@loopdog/core` (e.g. `core/run-record` or a `core/conventions` module) so both the
brief composer and the ingest matcher import one source of truth.

**Branch + PR conventions** (the contract the brief encodes; matched by 0073):

```
branch:  loopdog/<loop>/<issue>-<run_id>      # e.g. loopdog/implement/142-run_91c
PR title: <issue title>  (carried verbatim; loop may prefix nothing)
PR body:
  <one-line summary>
  Closes #<issue>                            # issue linkage (signal 3)
  <!-- loopdog:plan task=… milestone=… path=… -->
  loopdog-run: <run_id>                       # trailer (signal 2)
```

**Plan-as-contract block** — composed from the durable plan + the acceptance-criteria
marker; posted as an issue comment at claim and ensured on the PR body at ingest:

```html
<!-- loopdog:contract run=run_91c -->
### Plan contract
- Plan: <relative path>
<!-- loopdog:acceptance-criteria -->
- [x] <criterion> (test: <path>)      <!-- validated by adopter CI -->
- [x] <criterion> (manual)    <!-- validated by intent-diff (M10) -->
<!-- /loopdog:acceptance-criteria -->
<!-- /loopdog:contract -->
```

The block is rendered, not hand-written; the marker pair is copied **verbatim** from
the groomed issue (M08 · 0033) so the M03 DoR gate (0014) and the M10 intent-diff
read the same canonical criteria. The runner posts this *before* dispatch (so the
agent's brief references it) and reconciles it onto the PR *at ingest*.

**Ingest normalization** (called by the runner via 0073's ingest after correlation):
1. Ensure `loopdog-run:`, plan link, and `Closes #<issue>` exist in the PR body; patch
   missing pieces (the agent may have opened a barer PR than instructed) — defense in
   depth so correlation never depends on the agent's compliance.
2. Set label `loopdog:state/in-review`; remove `loopdog:state/in-progress`.
3. Ensure the contract block is present on the PR (copy from issue if absent).
4. If the PR is a draft and the loop's `pr.ready_on_ingest` is true, mark
   ready-for-review.

**Idempotency:** each write is upsert-by-marker — find the `<!-- loopdog:contract
run=... -->` / trailer by `run_id`; update in place rather than appending. Label sets
are declarative. A second ingest of the same PR produces no new comments and no label
churn (proven by a double-ingest test).

**Config keys** (per-loop `loop.yml`, validated in `@loopdog/config`):
`pr.draft` (open as draft; default false), `pr.ready_on_ingest` (default true),
`pr.title_prefix` (optional), `contract.post_on_issue` (default true). Branch/trailer
formats are **not** user-configurable in V1 (correlation depends on them).

**Edge cases:** agent opens the PR with a non-conforming branch but a valid trailer →
correlation (0073) still matches; normalization patches the body, label still applied.
Agent opens **no** PR within the lease → handled by 0073's sweep timeout (not here).
Multiple PRs correlate to one run → first-correlated wins; extras flagged for
escalation, not labeled. PR already `in-review` (re-event) → no-op.

## Out Of Scope

- The correlation match logic itself and the no-result/timeout path (0073).
- Composing the implementation brief body (0037) and blast-radius guards (0038).
- Adapter build/test and the CI re-verification gate (0040).
- The claim/lease protocol (0013) and run-record emission (0012).
- Review, intent-diff, and merge/auto-merge (M10).

## Acceptance Criteria

- [x] The brief instructs (and the contract module exports) the canonical branch
      `loopdog/<loop>/<issue>-<run_id>`, `Closes #<issue>`, and the `loopdog-run:`
      trailer — matching 0073's correlation signals.
- [x] At claim, the plan-as-contract block (with the verbatim acceptance-criteria
      marker) is posted on the issue.
- [x] At ingest, the correlated PR is labeled `loopdog:state/in-review`,
      `in-progress` is removed, and the contract block + trailer + issue linkage are
      ensured on the PR body.
- [x] All writes are upsert-by-marker: a double ingest produces no duplicate comments
      and no label churn (idempotent, proven by test).
- [x] A PR that opened without the trailer/linkage is patched to conform on ingest.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the branch/trailer/marker constants to `@loopdog/core` and import them in
      both the brief composer and the 0073 ingest matcher.
- [x] Implement the plan-contract composer (plan + acceptance-criteria marker →
      rendered block) in `@loopdog/runtime`.
- [x] Implement the issue-side post-on-claim step and the PR-side normalize-on-ingest
      step over `GitHubPort`.
- [x] Implement upsert-by-marker for comment/body writes and declarative label sets.
- [x] Add `pr.*` / `contract.*` keys to the loop schema in `@loopdog/config`.
- [x] Wire the steps into the implementation loop pipeline (runner 0012, ingest 0073).

## Test Plan

Tests run via the repo's `vitest` runner with the M18 fakes (`@loopdog/testing`
fake-GitHub + fake/replay backend) — no real quota, no real GitHub.

```bash
# scenario: claim → contract posted on issue; simulate agent PR → ingest labels
#           in-review, patches trailer/linkage, links the plan
# idempotency: deliver the same PR event twice → one comment, one label set
# nonconforming: agent PR missing trailer → normalize patches it; label still set
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

Branch/PR mechanics are the work cell's job under the non-overridable output
contract: branch `loopdog/<loop>/<issue>-<run_id>`, the `loopdog-run:` trailer,
the `#issue` reference — composed into every brief (0022) and verified by
correlation (0073). The plan contract is posted by grooming; the runner posts
dispatch/resolution markers.

## Risks / Rollback

If branch/trailer formats drift from 0073, correlation breaks and runs strand or
double-dispatch — mitigated by the single shared `@loopdog/core` constants. Posting a
contract before dispatch then patching on ingest risks duplicate comments if upsert
keying is wrong — the double-ingest idempotency test is the guard. Rollback: the loop
falls back to label-only transitions (no contract post) by disabling
`contract.post_on_issue`; correlation still works off branch + issue ref alone.

## Final Summary

Branch naming, PR opening, and contract posting ride the output contract +
correlation machinery rather than bespoke code — every backend produces the
identical shape, and ingest links PR→issue→plan.
