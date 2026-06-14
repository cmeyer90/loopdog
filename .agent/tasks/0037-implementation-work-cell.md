# 0037 Implementation Work Cell

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Ship the built-in **implement** loop: a dispatched work cell that takes a
`ready-for-agent` issue, implements the change against the plan's acceptance
criteria, adds a test per `test:` criterion, runs the project adapter's
build/test in the provider sandbox, and opens a PR that honors the correlation
contract (branch `loopdog/implement/<issue>-<run_id>` + `loopdog-run:` trailer +
issue ref). Like grooming (0033), this adds **no new code module** — it ships as
`templates/loops/implement/` assets executed by the generic runtime, plus a
golden scenario test.

## Background

Part of [Milestone 09](../milestones/milestone-09-implementation-loop.md) —
"implement against the plan using the project adapter for build/test, respect
blast-radius limits, and open a PR." Grounded in
[architecture](../../docs/architecture.md#the-loops) (implementation loop) and
[the execution model](../../docs/architecture.md#execution-model-orchestrate-provider-cloud-agents-over-github):
the controller claims/composes/dispatches and the **provider cloud agent** clones
the repo, runs build/test in its sandbox, and opens the PR — loopdog makes no
direct model call. The criteria the work cell builds against are the contract
grooming (0033) wrote and the DoR gate (0014) enforces; the PR it opens is
correlated and ingested by 0073; the adopter's CI re-verifies on the PR as the
trustworthy gate (rung 2). This is the implementation counterpart of the grooming
work cell (0033), at higher blast radius (it touches code), so blast-radius guards
(0038) are load-bearing.

It lands as `templates/loops/implement/` assets in `@loopdog/runtime` plus a built-in
`implement` policy fragment, with the golden scenario test in `@loopdog/testing`.
It consumes (does not define): brief composition + the `implement` policy
(0022), the DoR gate + marker parser (0014), dispatch/ingest correlation (0073),
adapter-driven build/test (0040), blast-radius guards (0038), branch/PR automation
(0039), and the in-memory `GitHubPort` + fake backend (M18 · 0083).

## Scope

- Author `templates/loops/implement/loop.yml` — the built-in implement loop
  definition (trigger, transition, backend, gates, blast radius).
- Author `templates/loops/implement/prompt.md` — the implementation brief that
  instructs the provider cloud agent to build against each acceptance criterion,
  add a test per `test:` criterion, run adapter build/test, and open a correlated
  PR.
- Ship a built-in `implement` policy fragment (test-per-criterion + halt-on-scope
  rules) inlined via 0022's `{% policy %}`.
- A **golden scenario test** (M18 tier 3, in `@loopdog/testing`): a fixture
  `ready-for-agent` issue with a criteria block → drive the real runner over fake
  GitHub + a fake/replay backend → assert the dispatched brief and the ingested
  PR honor the contract, the label advances to `in-review`, and the plan is kept
  accurate.

### Technical detail

**Loop definition** (`templates/loops/implement/loop.yml`, validated by 0006):

```yaml
name: implement
trigger: { github_event: issues }            # labeled ready-for-agent; sweep (0076) backstops handoff from groom
transition: { from: ready-for-agent, to: in-progress }   # ingest of the PR (0073) advances in-progress -> in-review
backend: claude                              # per-loop selectable (0023); review (M10) prefers a different provider
gates: { require_dor: true, require_ci: true, tier: core }  # MUST consume a real DoR contract; CI re-verifies on the PR
blast_radius: { max_files: 20, max_diff: 400 }   # 0038 enforces; scope-exceeding work halts + escalates
mode: dry-run                                # 0036 promotes; safe-by-default (0009)
```

`require_dor: true` is the inverse of grooming's `require_dor: false`: implement
*consumes* the DoR contract and must refuse to start without it (DoR gate 0014
routes a criteria-less item back to `needs-grooming`). `tier: core` keeps it
human-gated at merge until the verification ladder is proven. The two-edge note
matters: the runner advances `ready-for-agent -> in-progress` at dispatch; the
provider's PR is ingested by a *later* invocation (0073) which advances
`in-progress -> in-review` — long provider work is async (0012 single-step).

**The implementation brief** (`templates/loops/implement/prompt.md`). Markdown
with the fixed 0022 placeholder vocabulary
(`{{issue.title}}`, `{{issue.number}}`, `{{issue.body}}`, `{{acceptance_criteria}}`,
`{{transition.to}}`, `{{run_id}}`, `{{branch}}`, `{{repo.default_branch}}`,
`{{adapter.test_cmd}}`) and a `{% policy implement %}` directive. It instructs the
agent to:

1. Read the issue + the injected `{{acceptance_criteria}}` block — **this is the
   contract**; implement to satisfy every criterion, nothing more.
2. For each `test:`-tagged criterion, add or extend the referenced test so the
   criterion is objectively verifiable by the adopter's CI (DoD rung 2). For
   `manual:` criteria, implement to satisfy the stated intent (judged later by the
   intent-diff, M10 · 0043).
3. Run the adapter's build then test (`{{adapter.test_cmd}}`, supplied by 0040) in
   the provider sandbox; iterate until green or until blocked.
4. **Respect blast radius (0038):** if satisfying the criteria requires exceeding
   `max_files` / `max_diff`, **do not balloon the change** — stop, summarize why
   scope was exceeded, and signal escalation rather than opening an over-large PR.
5. Open a PR on branch `{{branch}}` (`loopdog/implement/<issue>-<run_id>`) labeled
   `{{transition.to}}`, referencing `#{{issue.number}}` (closes), with the
   acceptance-criteria checklist in the PR body marked off per criterion.

The composer (0022) always appends the non-overridable output-contract trailer
(branch `loopdog/implement/<issue>-<run_id>`, `loopdog-run: <run_id>` PR-body
trailer, label per `transition.to`, issue ref) so the PR correlates back on
ingest (0073) — defense in depth across all three signals.

**Built-in `implement` policy fragment** (`@loopdog/runtime`, inlined via
`{% policy implement %}`): encodes the durable rules independent of any single
issue — (a) **test-per-`test:`-criterion is mandatory**; a PR missing a test for a
testable criterion is incomplete; (b) **scope discipline / halt-on-exceed** wording
matching 0038; (c) keep the durable plan accurate (check off the implementation
checklist + append a verification-log line for the build/test run) so the plan
reflects the actual work at PR time (Milestone 09 DoD); (d) no secrets in
model-visible output (secret-hygiene, 0022).

**Blast-radius interaction (0038).** 0038 owns the guard mechanism; this task
*uses* it two ways: the brief instructs the agent to self-limit, and the runner
re-checks the ingested PR's diff against `max_files`/`max_diff` on ingest — an
over-limit PR is **not merged**; the item is routed to escalation
(`needs-human` / `loopdog:quarantine` per resilience policy M19) with the overage
recorded. Belt-and-suspenders: the model is asked to stop early, and the
deterministic controller enforces it regardless.

**Ingest → in-review.** On the agent's PR event, the runner ingests (0073),
correlates via branch + `loopdog-run:` trailer + issue ref, updates the run record,
appends the build/test result to the bound plan's verification log, marks the
satisfied criteria, and advances the label `in-progress -> in-review` (mirroring
plan `Status` per 0017). The controller→controller handoff to the review loop
(M10) is carried by the cron sweep (0076), since `GITHUB_TOKEN` won't re-trigger.

**Golden scenario test** (`@loopdog/testing/src/scenario/`, M18 tier 3): a fixture
`ready-for-agent` issue ("add rate limiting") with a 0014 criteria block seeded
into fake GitHub (0083); a fake/replay backend returns a scripted PR on branch
`loopdog/implement/<issue>-<run_id>` with a `loopdog-run:` trailer, an `#issue` ref,
and a test file per `test:` criterion; the real runner dispatches then ingests.
Golden assertions: (a) the dispatched brief contained the injected criteria block
+ the non-overridable output-contract trailer; (b) the ingested PR correlates on
all three signals; (c) the PR adds ≥1 test per `test:` criterion (fixture-level
check); (d) the label is `in-review`; (e) the bound plan's verification log records
the adapter build/test run. A second fixture returns an over-limit PR → assert the
runner escalates instead of advancing (0038 path). Deterministic, offline, zero
quota.

## Out Of Scope

- The blast-radius guard *mechanism* (max-files/max-diff predicate + escalate)
  (0038); branch/PR-open + plan-contract-posting mechanics (0039); adapter
  build/test command resolution (0040) — this task ships the assets that exercise
  them and the brief wording that drives them.
- The DoR gate predicate + marker parser (0014); brief composition engine +
  `implement` placeholder rendering (0022); ingest correlation matching (0073);
  per-loop backend selection (0023) — consumed here, defined elsewhere.
- The review/intent-diff judgment (M10 · 0043) and merge authority (M10); Action
  trigger wiring + dry-run promotion (0036, mirrored for this loop).

## Acceptance Criteria

- [x] `templates/loops/implement/loop.yml` exists, validates against the 0006
      schema, declares `from: ready-for-agent -> to: in-progress`,
      `require_dor: true`, `require_ci: true`, `tier: core`, a `max_files`/`max_diff`
      blast radius, and `mode: dry-run`.
- [x] `templates/loops/implement/prompt.md` produces, when composed (0022), a brief
      that injects `{{acceptance_criteria}}`, instructs build-against-each-criterion
      + a test per `test:` criterion + run `{{adapter.test_cmd}}` + halt-on-scope-
      exceed, and targets a correlated PR (branch + trailer + issue ref).
- [x] The built-in `implement` policy fragment encodes test-per-criterion,
      halt-on-exceed, plan-accuracy, and secret-hygiene rules and is inlined via
      `{% policy implement %}`.
- [x] The DoR gate (0014) blocks dispatch on a criteria-less issue (routed back to
      grooming/human), proven by a negative scenario.
- [x] On ingest, the PR correlates on branch + `loopdog-run:` trailer + issue ref
      (0073), the label advances to `in-review`, and the bound plan's verification
      log records the build/test run.
- [x] An over-limit ingested PR escalates instead of advancing (0038 path),
      proven by a scenario fixture.
- [x] The golden scenario test passes offline on fake GitHub + fake backend (no
      real quota) and asserts the full contract above.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Write `templates/loops/implement/loop.yml` and confirm it validates via
      `loopdog loops validate implement`.
- [x] Write `templates/loops/implement/prompt.md` (0022 placeholders +
      `{% policy implement %}` + DoR-contract + test-per-criterion + halt-on-scope
      instructions).
- [x] Ship the built-in `implement` policy fragment in `@loopdog/runtime`.
- [x] Add the fixture `ready-for-agent` issue + scripted PR backend response (and an
      over-limit variant) in `@loopdog/testing`.
- [x] Write the golden scenario test: dispatch brief shape, PR correlation, test-
      per-criterion, label = `in-review`, plan verification-log update, and the
      over-limit escalation path.
- [x] Add the criteria-less negative scenario (DoR gate blocks dispatch).
- [x] Update the loop walkthrough/docs if the built-in implement asset shape changed.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral paths use the M18 fakes
(in-memory GitHub from 0083 + fake/replay backend) — no real GitHub, no quota.

```bash
# from repo root
npm test -w @loopdog/runtime    # implement loop.yml validates; brief composes with the implement policy
npm test -w @loopdog/testing    # golden scenario: ready-for-agent issue -> dispatch -> ingest -> in-review
# golden: seed criteria-bearing issue -> run implement -> assert brief injects criteria + contract,
#         ingested PR correlates (branch+trailer+ref), ≥1 test per test: criterion, label = in-review,
#         plan verification log updated
# negative: criteria-less issue -> DoR gate blocks dispatch; over-limit PR -> escalate, no advance
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- The implementation work cell is the `implement` loop asset: pull-request
  expectation, DoR-gated (require_dor true), the prompt mandates
  criteria-driven implementation, tests per test-tagged criterion, plan
  upkeep, and the correlation contract (appended non-overridably).
- ready-for-agent → in-review spans the canonical in-progress intermediate;
  the dispatched item is sweep-visible throughout (scanStates).

## Risks / Rollback

This is the first **code-touching** work cell, so blast radius is the central
risk: without the 0038 guard a runaway agent could open a sprawling PR. Mitigated
belt-and-suspenders — the brief instructs the agent to self-limit *and* the runner
re-checks the ingested diff and escalates over-limit PRs, never merging them. A
malformed correlation strands or double-dispatches the run (0073's risk inherited
here) — covered by the three-signal assertion in the golden test. If the brief
under-tests (skips a `test:` criterion), the DoD gate (0014) blocks merge, so a
weak PR fails closed rather than merging. Rollback is asset-only: the loop ships
`mode: dry-run` until 0036 promotes it, and reverting `templates/loops/implement/`
removes the behavior with no code change.

## Final Summary

Implementation ships as loop data over the generic pipeline: claim → brief
(criteria+scope+discussion) → dispatch → PR ingest with correlation →
in-review, with the plan updated at each step — proven in the e2e flow.
