# 0014 DoR / DoD Contract Gates

Status: planned  
Branch: task/0014-dor-dod-contract-gates

## Goal

Make "ready to implement" and "done" **machine-checkable**: programmatic
Definition-of-Ready and Definition-of-Done gates the transition runner enforces,
so a loop can't start on an underspecified issue or merge unsatisfied work.

## Background

Part of [Milestone 03](../milestones/milestone-03-github-state-machine-core.md).
These gates are the backbone of intent validation — see
[architecture](../../docs/architecture.md#how-we-know-the-request-was-satisfied).
Grooming (M08) produces the acceptance criteria these gates read; the merge loop
(M10) consumes the DoD gate.

## Scope

- A DoR gate: the implementation loop refuses to start unless readiness holds.
- A DoD gate: the merge loop refuses unless doneness holds.
- A parseable representation of acceptance criteria so gates evaluate them.
- Per-loop gate config (`require_dor`, `require_ci`, `tier`, …) honored by the
  runner.

### Technical detail

**Where criteria live.** The durable plan task file (M04) carries an Acceptance
Criteria checklist; it is mirrored to the issue body in a fenced marker block so
the gate can parse it from GitHub state alone:

```
<!-- looper:acceptance-criteria -->
- [ ] per-API-key limiting at 100 req/min            (test: api/ratelimit.test.ts)
- [ ] returns 429 + Retry-After when exceeded         (test: …)
- [ ] limit configurable via env                      (manual)
<!-- /looper:acceptance-criteria -->
```

**DoR gate** passes when: ≥1 acceptance criterion present, scope bounds present,
and a test plan present (each criterion tagged `test:` or `manual:`). Missing →
the runner routes the item to `needs-grooming` (or `needs-human`) instead of
dispatching. A loop may set `require_dor: false` to opt out (the runner emits the
warning surfaced by `looper loops validate`).

**DoD gate** passes when: every acceptance criterion is checked, required CI
checks are green, review is approved, and (if the loop deploys) deploy smoke
passed. The `test:`-tagged criteria are validated objectively by CI (rung 2); the
`manual:` ones by the intent-diff reviewer (M10 · 0043). The gate reads check-run
status + review state from GitHub + the criteria block.

## Out Of Scope

- Generating criteria (M08 grooming); the intent-diff judgment itself (M10 · 0043).

## Acceptance Criteria

- [ ] The DoR gate blocks an implement transition when criteria/scope/test-plan
      are absent and routes the item back to grooming/human.
- [ ] The DoD gate blocks merge unless all criteria are checked + CI green +
      review approved (+ deploy smoke when applicable).
- [ ] Criteria parse from the issue-body marker block deterministically.
- [ ] Per-loop `require_dor`/`require_ci`/`tier` config is honored; `require_dor:
      false` emits a warning, not a silent skip.

## Implementation Checklist

- [ ] Define + parse the acceptance-criteria marker block.
- [ ] Implement the DoR predicate + the not-ready routing.
- [ ] Implement the DoD predicate over criteria + checks + reviews + smoke.
- [ ] Wire gate config from `loop.yml`; surface `require_dor:false` warnings.

## Test Plan

```bash
# replace with the chosen stack's runner
# issue with no criteria → DoR blocks; full criteria + green CI + approval → DoD passes
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the criteria block format, the test/manual tagging convention, and how
strictly DoD treats `manual:` criteria.

## Risks / Rollback

If criteria parsing is brittle, gates misfire (block good work or pass bad). Keep
the marker format simple and validated; default to *blocking* on parse failure
(fail closed), never passing.

## Final Summary

Fill this in before marking verified.
