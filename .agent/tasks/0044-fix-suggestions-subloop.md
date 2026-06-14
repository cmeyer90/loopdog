# 0044 Fix-Suggestions Sub-Loop

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Close the review feedback loop: when cross-model review (0042) / intent-diff
(0043) returns a split verdict, compose a **fix brief** from the unmet criteria +
findings, dispatch it back to the *implementer* on the same PR branch, re-run the
adopter's CI (rung 2), and re-request review — iterating `changes-requested ⇄
in-review` until every criterion is met (advance toward `verified`) or the attempt
budget is exhausted (escalate to `needs-human`). Ships as the built-in `fix` loop
asset.

## Background

Part of [Milestone 10](../milestones/milestone-10-review-verification-ladder-and-merge-loop.md)
— the "fix-and-revalidate sub-loop" the milestone's Definition of Done requires so
review findings *flow into* a revalidate cycle rather than dead-ending at
`changes-requested`. See [architecture](../../docs/architecture.md) "The
verification ladder (trust)" and "How we know the request was satisfied" (step 4 →
"Unmet criteria route to the fix-and-revalidate sub-loop, not to merge"). This is a
**loops-as-data** asset, not a new code module ([codebase](../../docs/codebase.md)
`runtime/loops-builtin`): a `templates/loops/fix/` folder executed by the generic
stateless runner (0012), dispatched via the execution-backend interface and
correlated by 0073. It sits between 0043 (which *routes* a split verdict here) and
re-entry into 0041/0042/0043 (which re-evaluate the new commit). No new package.

## Scope

- A built-in `fix` loop (`templates/loops/fix/loop.yml` + `prompt.md`)
  transitioning `changes-requested → in-review`, executed by the generic runner.
- **Fix-brief composition**: turn the unmet/uncertain verdicts (+ evidence) and
  blocker findings from 0043's `IntentDiff` into a targeted brief, scoped to the
  *same PR branch*, dispatched to the **implementer** backend (continue the work,
  not a new author).
- **Revalidate**: on the fix commit, CI re-runs (the adopter's checks, rung 2 /
  0041) and review is re-requested (0042/0043 re-run on the new SHA) — the cycle is
  carried by ingest events + the cron sweep (0076).
- **Iteration accounting + escalation**: a per-item fix-attempt counter; exhausting
  the resilience budget (M19) routes to `needs-human` instead of looping forever.
- A golden scenario test on fake GitHub + fake backend asserting the full
  changes-requested → fix → re-review → verified cycle and the escalation path.

### Technical detail

**Package(s):** the loop ships in `@loopdog/runtime` as `templates/loops/fix/`
assets (scaffolded by `loopdog init`). The fix-brief composition is a pure helper in
`@loopdog/runtime` (pipeline); the verdict/finding inputs are the `IntentDiff` /
`CriterionVerdict` types from `@loopdog/core` (0043). Dispatch + correlation reuse
`Backend.dispatch` / 0073. No new package, no new port.

**`loop.yml`:**

```yaml
# templates/loops/fix/loop.yml
name: fix
trigger: { github_event: pull_request_review }   # changes-requested verdict ingested
transition: { from: changes-requested, to: in-review }
backend: implementer        # sentinel: resolve to the PR's original implementer (mirror of 0042's cross-model)
gates: { require_unmet_findings: true }          # no actionable findings → don't dispatch
```

`backend: implementer` is the inverse of 0042's `cross-model` sentinel: the
pipeline loads the PR's implement run record (0073 correlation) and dispatches the
fix to **that same provider** (continuity — the original author iterates its own
branch). This is allowed precisely because review stays cross-model; the fix is not
a self-review.

**Fix-brief composition** (pure helper in `runtime`, brief asset
`templates/loops/fix/prompt.md`): the input is the persisted split verdict from
0043 — the `unmet`/`uncertain` `CriterionVerdict[]` (id + text + evidence) plus any
`severity: blocker` review findings (0042's verdict block). The brief instructs the
agent to, on the **existing PR head branch** `loopdog/<loop>/<issue>-<run_id>`
(amend the PR, do not open a new one): address *each* listed criterion/finding,
keep the change scoped to those (respect the implement loop's blast-radius limits),
re-run tests locally, and push to the same branch. `test:`-tagged criteria that
failed in CI are included as "make these acceptance tests pass" — the agent fixes
the code, never edits the CI gate (rung 2 is the check loopdog cannot edit). The new
dispatch gets a fresh `run_id`; the PR is the same.

**Revalidate cycle (who advances what):**

1. Fix dispatch → agent pushes to the PR branch (new commit / new head SHA).
2. The push fires `pull_request: synchronize` → the adopter's CI re-runs on the new
   SHA; the ladder (0041) re-evaluates rung 2 against the current head SHA.
3. The loop sets the label back to `in-review`, which re-arms the review loop
   (0042). Because a `GITHUB_TOKEN`-written label does **not** re-trigger a
   workflow, this controller→controller handoff is carried by the **cron sweep
   (0076)** (an optional PAT makes it instant); the human/provider events fire
   normally.
4. Re-review (0042) + re-intent-diff (0043) run on the new commit; `allMet` →
   advance toward `verified`; still split → back to `changes-requested` → this loop
   again.

**Iteration accounting (don't loop forever):** the runner already tracks an
attempt counter per item (0012); this loop reads a **fix-cycle counter** keyed on
`(item, "fix")` and compares it to the resilience policy (M19,
`max_attempts_per_item` / the per-loop `resilience.max_fix_attempts`, default 2). On the cycle
that would exceed it: stop dispatching, record `status: escalated`, set
`needs-human`, and post a comment summarizing the still-unmet criteria + the last
evidence (so a human inherits full context). The counter resets when the PR reaches
`verified`.

**Edge cases (fail safe):**
- **No actionable findings** (label is `changes-requested` but the persisted
  verdict has zero `unmet`/`uncertain` and no blocker — e.g. only CI red) → the
  `require_unmet_findings` gate composes the brief from the failing **required CI
  contexts** (0041 ladder result) instead; if there is genuinely nothing to act on,
  escalate rather than dispatch an empty brief.
- **Same verdict re-ingested** → idempotent per 0012/0073: a fix is dispatched at
  most once per `(item, head SHA, fix-cycle)`; a duplicate event is a no-op.
- **Agent opens a *new* PR instead of amending** → correlation (0073) still ties it
  to the run; the loop links it to the original issue/criteria, but prefers the
  same-branch amend (brief instructs it); a divergent new PR is surfaced for the
  human.
- **No new commit within the lease** (agent produced nothing) → sweep timeout
  (0073) → counts as a failed cycle → backoff/escalation (M19 · 0051).
- **Oscillation** (a fix unmets a previously-met criterion) → the next intent-diff
  catches it because 0043 re-judges *all* `manual:` criteria on each commit; the
  cycle counter bounds the churn.

## Out Of Scope

- The reviewer-selection / cross-model dispatch and review verdict block (0042).
- The intent-diff verdict schema, checkbox mapping, and the split-routing *decision*
  that hands work here (0043 — this task consumes its output).
- Ladder rung evaluation / required-check binding (0041) and final merge authority +
  risk tiers (0045).
- The resilience taxonomy/knobs themselves (M19) and stuck-detection (M12 · 0051);
  this loop *reads* the policy and *hands off* on exhaustion, it doesn't define them.

## Acceptance Criteria

- [x] `templates/loops/fix/{loop.yml,prompt.md}` exist, validate against the config
      schema (M02), and run `from=changes-requested → to=in-review`.
- [x] A split verdict from 0043 composes a fix brief listing **each** unmet/uncertain
      criterion + blocker finding with its evidence, dispatched to the **implementer**
      backend on the **same PR branch** (no new PR on the happy path).
- [x] After the fix commit, CI re-runs on the new head SHA and review is re-requested
      (label returns to `in-review`); the re-review/intent-diff runs on the new commit.
- [x] The cycle advances to `verified` only when every criterion is met (via 0043),
      never directly from this loop.
- [x] A per-item fix-cycle counter is enforced; exceeding `resilience.max_fix_attempts` (M19) routes
      to `needs-human` with a summary of still-unmet criteria, never an infinite loop.
- [x] A `changes-requested` PR with no actionable findings escalates (or composes
      from failing required CI), never dispatches an empty brief.
- [x] Dispatch is idempotent per `(item, head SHA, fix-cycle)`; a duplicate
      review/sweep event causes no second dispatch.
- [x] A golden scenario test proves the full changes-requested → fix → re-review →
      verified cycle and the exhaustion → needs-human escalation.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Author `templates/loops/fix/loop.yml` (trigger/transition/`backend: implementer`/`require_unmet_findings` gate).
- [x] Author `templates/loops/fix/prompt.md` (per-criterion fix brief: address each unmet criterion/finding on the same branch, fix code not CI, re-run tests).
- [x] Implement the `implementer` backend-resolution helper in `runtime` (read implementer from the PR's implement run record via 0073).
- [x] Implement fix-brief composition from 0043's persisted `IntentDiff` (unmet/uncertain + blocker findings + evidence); CI-only fallback path.
- [x] Implement the fix-cycle counter + `resilience.max_fix_attempts` check (M19) → escalate to `needs-human` on exhaustion with a still-unmet summary.
- [x] Wire the label flip back to `in-review` and confirm the sweep (0076) re-arms review; assert idempotent dispatch per (item, SHA, cycle).
- [x] Register `fix` in the built-in loop assets and `loopdog init` scaffold.
- [x] Add the golden scenario test + fixtures (full cycle + escalation).

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backends from `@loopdog/testing`) — no real quota,
deterministic, offline.

```bash
# from repo root, run the runtime package suite
pnpm -F @loopdog/runtime test
# scenario: split verdict (1 unmet) → fix brief lists that criterion+evidence →
#   dispatch to implementer on same branch → fix commit → CI re-runs → re-review →
#   all met → advances toward verified.
# scenario: criterion still unmet after max_fix_attempts → escalates to needs-human with summary.
# scenario: changes-requested with no actionable findings → escalate (no empty brief).
# scenario: same review/sweep event delivered twice → single fix dispatch (idempotent).
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- The fix loop re-enters implementation on the SAME PR: changes-requested →
  in-review via in-progress, with the reviewer's findings in the brief
  discussion context and the prompt mandating address-every-finding.
- Correlation handles the existing-PR case: a pre-existing PR only completes
  ingest once updatedAt is after dispatch (the agent actually pushed) —
  implemented in ingestViaCorrelation and regression-tested.

## Risks / Rollback

- **Infinite churn** — a fix that never satisfies a criterion loops forever and
  burns quota. Defense: the bounded fix-cycle counter + M19 backoff; exhaustion
  always lands in `needs-human`, never silent retry.
- **Scope creep on the fix** — an unconstrained fix brief rewrites unrelated code.
  Defense: the brief is scoped to the listed criteria + the implement loop's
  blast-radius limits; out-of-scope churn is a review finding next cycle.
- **Editing the gate, not the code** — an agent "fixes" a `test:` failure by
  weakening the test. Defense: the brief forbids touching CI/tests-as-gate (rung 2
  is the check loopdog cannot edit), and a CODEOWNERS-protected test path catches it.
- Rollback: the loop is data — disabling `fix` (remove the asset / `enabled: false`)
  reverts to a human acting on `changes-requested`, with no code change and no loss
  of the persisted verdict.

## Final Summary

Fix-and-revalidate is a loop asset re-using the whole pipeline; the
updated-after-dispatch correlation rule makes same-PR iteration safe; the e2e
flow exercises changes-requested → fix → re-review → approve.
