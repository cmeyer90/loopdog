# 0033 Grooming Work Cell

Status: planned  
Branch: task/0033-grooming-work-cell

## Goal

Ship looper's first dispatched work cell: a built-in **groom** loop that takes a
raw issue and produces Definition-of-Ready — a `<!-- looper:acceptance-criteria -->`
marker block (each criterion tagged `test:`/`manual:`), explicit scope bounds, and
a test plan — then binds the durable plan and posts the plan-as-contract. The brief
edits only issue text + plans, never code, so it proves triggering, claiming,
dispatch, and plan binding at the lowest blast radius.

## Background

Part of [Milestone 08](../milestones/milestone-08-grooming-and-clarification-loop.md)
— "transform raw issues to Definition-of-Ready, create the durable plan, post a
plan-as-contract." Grounded in
[architecture](../../docs/architecture.md#how-we-know-the-request-was-satisfied):
*you cannot validate satisfaction until the request is machine-checkable*, and the
validation chain **begins at grooming**. The criteria this work cell writes are the
contract the DoR gate (0014) reads, the implementation loop (M09) builds against,
and the intent-diff (M10 · 0043) judges.

This task is **loop-as-data**: it adds *no new code module*. The grooming behavior
ships as the built-in asset `templates/loops/groom/` (executed by the generic
`@looper/runtime` pipeline, 0012) and a built-in `groom` policy fragment. It depends
on: the marker-block format + DoR predicate (0014), brief composition (0022),
issue↔plan binding + label↔Status mirror (0016), dispatch/ingest correlation (0073),
and the in-memory `GitHubPort` scenario harness (M18 · 0083). The clarification
responder is 0034; the deterministic assume-vs-block rule is **deferred to 0035**
(here we bias to assume-and-proceed and *state* assumptions inline); the Action
trigger wiring + dry-run mode is 0036.

## Scope

- Author `templates/loops/groom/loop.yml` — the built-in groom loop definition
  (trigger, transition, backend, gates), shipped by `@looper/runtime`.
- Author `templates/loops/groom/prompt.md` — the grooming brief that instructs the
  provider cloud agent to emit DoR: the acceptance-criteria marker block, scope
  bounds, and a test plan, editing only the issue body + plan files.
- Ship a built-in `groom` policy fragment encoding the DoR output contract +
  assume-and-proceed bias (composed in via 0022's `{% policy %}`).
- A **golden scenario test** (M18 tier 3, in `@looper/testing`): a fixture raw
  issue → drive the real runner over fake GitHub + a fake/replay backend → assert
  the DoR output shape (parseable marker block, ≥1 `test:` criterion, scope + test
  plan present, plan bound, contract comment posted, label advanced to
  `ready-for-agent`).

### Technical detail

**Loop definition** (`templates/loops/groom/loop.yml`, validated by 0006):

```yaml
name: groom
trigger: { github_event: issues }          # new/needs-grooming issue; sweep (0076) backstops
transition: { from: needs-grooming, to: ready-for-agent }
backend: claude                            # cross-provider review later prefers a different one
gates: { require_dor: false, tier: safe }  # groom PRODUCES DoR, so it can't require it as input
blast_radius: { paths: [".agent/**", "issue-body"] }   # edits plans + issue text only, never code
mode: dry-run                              # 0036 promotes; safe-by-default (0009)
```

`require_dor: false` is load-bearing: grooming is the step that *creates* the DoR
the gate (0014) later enforces, so it must be exempt from it. `tier: safe` +
the plan/issue-only blast radius keep this the lowest-risk loop.

**The grooming brief** (`templates/loops/groom/prompt.md`). Markdown with the
fixed 0022 placeholder vocabulary (`{{issue.title}}`, `{{issue.number}}`,
`{{issue.body}}`, `{{transition.to}}`, `{{run_id}}`, `{{branch}}`,
`{{adapter.test_cmd}}`) and a `{% policy groom %}` directive. It instructs the
agent to:

1. Read the raw issue; restate the goal in one or two sentences.
2. Derive **acceptance criteria** — concrete, independently checkable outcomes —
   and emit them as the marker block, tagging each `test:` (objectively verifiable
   by the adopter's CI; reference a plausible test path using `{{adapter.test_cmd}}`
   when known) or `manual:` (verifiable only by a cross-provider intent-diff).
   **Bias `test:` wherever the criterion can be encoded as a test** (DoD rung 2).
3. State **scope bounds**: in-scope, out-of-scope, and any unstated assumptions
   made — *prefer stating an assumption and proceeding over asking* (0035 owns the
   hard-block rule; here, ambiguity becomes an explicit assumption, not a block).
4. Write a short **test plan** (how each `test:` criterion is exercised).
5. Apply the edits to the issue body + the bound plan file only — **touch no code**.

The composer (0022) always appends the non-overridable output-contract trailer
(branch `looper/groom/<issue>-<run_id>`, `looper-run:` PR trailer, issue ref) so the
plan-edit PR/comments correlate back on ingest (0073).

**The DoR output shape** the brief must produce (and the test asserts), mirroring
0014's marker format exactly:

```
<!-- looper:acceptance-criteria -->
- [ ] rate limit enforced at 100 req/min per API key   (test: api/ratelimit.test.ts)
- [ ] returns 429 + Retry-After when exceeded          (test: api/ratelimit.test.ts)
- [ ] limit is configurable via env var                (manual)
<!-- /looper:acceptance-criteria -->

### Scope
In: per-key limiting + 429 response. Out: per-IP limiting, distributed quota.
Assumptions: fixed-window (not sliding); in-process store — stated, not blocked.

### Test plan
Drive N+1 requests in one window → assert 429 + Retry-After; set env → assert new limit.
```

**Ingest → DoR.** On the agent's plan-edit PR/comment event, the runner ingests
(0073), and the **0016 bind/mirror** step writes the criteria block verbatim into
the bound task file's Acceptance Criteria, posts the **plan-as-contract** comment on
the issue, and advances the label `needs-grooming → ready-for-agent` (which mirrors
plan `Status: planned → ready`). The controller→controller handoff to the implement
loop is carried by the cron sweep (0076), since `GITHUB_TOKEN` won't re-trigger.

**Golden scenario test** (`@looper/testing/src/scenario/`, M18 tier 3): a fixture
raw issue ("add rate limiting") seeded into fake GitHub (0083); a fake/replay
backend returns a scripted DoR plan-edit PR; the real runner grooms it; golden
assertions: (a) the issue body contains a *parseable* marker block with ≥1 `test:`
criterion, (b) scope + test-plan sections present, (c) the bound plan file exists
with the criteria mirrored, (d) a contract comment was posted, (e) the label is
`ready-for-agent`. Deterministic, offline, zero quota.

## Out Of Scope

- The deterministic assume-vs-block / `needs-clarification` policy (0035) — here we
  only *state* assumptions inline.
- The event-driven clarification responder (0034); the Action trigger wiring +
  dry-run promotion (0036).
- The DoR gate predicate + marker parser (0014); brief composition engine (0022);
  bind/mirror + contract-comment mechanics (0016); ingest correlation (0073) — this
  task *consumes* them and ships the assets that exercise them.

## Acceptance Criteria

- [ ] `templates/loops/groom/loop.yml` exists, validates against the 0006 schema,
      declares `from: needs-grooming → to: ready-for-agent`, `require_dor: false`,
      `tier: safe`, an issue+plan-only blast radius, and `mode: dry-run`.
- [ ] `templates/loops/groom/prompt.md` produces, when composed (0022), a brief that
      instructs the agent to emit the `<!-- looper:acceptance-criteria -->` block
      (each criterion tagged `test:`/`manual:`), scope bounds, and a test plan, and
      to edit only the issue body + plan files.
- [ ] The built-in `groom` policy fragment encodes the DoR output contract + the
      assume-and-proceed bias and is inlined via `{% policy groom %}`.
- [ ] The DoR output the brief targets parses with the 0014 marker parser and has
      ≥1 `test:`-tagged criterion (biased to testable).
- [ ] On ingest, the criteria are mirrored into the bound plan (0016), the
      plan-as-contract comment is posted, and the label advances to
      `ready-for-agent`.
- [ ] The golden scenario test passes offline on fake GitHub + fake backend (no real
      quota) and asserts the full DoR output shape above.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Write `templates/loops/groom/loop.yml` (trigger/transition/backend/gates/blast
      radius/dry-run) and confirm it validates via `looper loops validate groom`.
- [ ] Write `templates/loops/groom/prompt.md` (DoR instructions + 0022 placeholders
      + `{% policy groom %}`).
- [ ] Ship the built-in `groom` policy fragment in `@looper/runtime`.
- [ ] Add the fixture raw issue + scripted DoR backend response in `@looper/testing`.
- [ ] Write the golden scenario test asserting the DoR output shape, plan binding,
      contract comment, and label advance.
- [ ] Update the loop walkthrough/docs if the built-in groom asset shape changed.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral paths use the M18 fakes
(in-memory GitHub from 0083 + fake/replay backend) — no real GitHub, no quota.

```bash
# from repo root
npm test -w @looper/runtime    # groom loop.yml validates; brief composes with the groom policy
npm test -w @looper/testing    # golden scenario: raw issue → asserted DoR output shape
# golden: seed fixture issue → run groom → assert parseable marker block (≥1 test:),
#         scope + test plan, plan bound, contract comment, label = ready-for-agent
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final `loop.yml` knobs (esp. `require_dor: false` rationale + blast
radius), the brief's DoR section structure, the `test:`/`manual:` tagging guidance,
the assume-and-proceed phrasing (and why the hard-block decision defers to 0035),
and the golden scenario's asserted shape.

## Risks / Rollback

If the brief produces a malformed marker block, the 0014 parser fails closed and the
item never reaches `ready-for-agent` — guard by asserting the exact block shape in
the golden test. If grooming is too eager to assume, a mis-groomed contract validates
the wrong target confidently downstream (architecture's "honest limit") — mitigated
by stating assumptions explicitly (human-visible in the contract comment) and by
0035 later adding the hard-block rule. Rollback is asset-only: the loop ships
`mode: dry-run` (comment-only until 0036 promotes), and deleting/reverting
`templates/loops/groom/` removes the behavior with no code change.

## Final Summary

Fill this in before marking verified.
