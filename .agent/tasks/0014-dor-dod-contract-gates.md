# 0014 DoR / DoD Contract Gates

Status: verified  
Branch: claude/laughing-johnson-8a7944

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
<!-- loopdog:acceptance-criteria -->
- [ ] per-API-key limiting at 100 req/min            (test: api/ratelimit.test.ts)
- [ ] returns 429 + Retry-After when exceeded         (test: …)
- [ ] limit configurable via env                      (manual)
<!-- /loopdog:acceptance-criteria -->
```

**DoR gate** passes when: ≥1 acceptance criterion present, scope bounds present,
and a test plan present (each criterion tagged `test:` or `manual:`). Missing →
the runner routes the item to `needs-grooming` (or `needs-human`) instead of
dispatching. A loop may set `require_dor: false` to opt out (the runner emits the
warning surfaced by `loopdog loops validate`).

**DoD gate** passes when: every acceptance criterion is checked, required CI
checks are green, review is approved, and (if the loop deploys) deploy smoke
passed. The `test:`-tagged criteria are validated objectively by CI (rung 2); the
`manual:` ones by the intent-diff reviewer (M10 · 0043). The gate reads check-run
status + review state from GitHub + the criteria block.

## Out Of Scope

- Generating criteria (M08 grooming); the intent-diff judgment itself (M10 · 0043).

## Acceptance Criteria

- [x] The DoR gate blocks an implement transition when criteria/scope/test-plan
      are absent and routes the item back to grooming (runner test: ungroomed
      item → `needs-grooming` + explanatory comment).
- [x] The DoD gate blocks merge unless all criteria are checked + CI green +
      review approved (+ deploy smoke when applicable) — full predicate matrix
      unit-tested incl. latest-review-per-author semantics.
- [x] Criteria parse from the issue-body marker block deterministically
      (round-trip + malformed-line tests; untagged criteria are malformed).
- [x] Per-loop `require_dor`/`require_ci`/`tier` config is honored by the
      runner (`GateConfig`); the `require_dor: false` warning surfaces in
      config validation (`loopdog loops validate`, M02 · 0006 wiring).

## Implementation Checklist

- [x] Define + parse the acceptance-criteria marker block (+ render + upsert,
      and the scope marker block).
- [x] Implement the DoR predicate + the not-ready routing (`DOR_FAIL_ROUTE`).
- [x] Implement the DoD predicate over criteria + checks + reviews + smoke.
- [x] Wire gate config from `loop.yml` (`GateConfig` on `LoopDefinition`;
      schema + warning surfacing land with the config package, M02 · 0006).

## Test Plan

```bash
# replace with the chosen stack's runner
# issue with no criteria → DoR blocks; full criteria + green CI + approval → DoD passes
```

## Verification Log

- 2026-06-09: gates suite green (11 tests): criteria round-trip, malformed
  flagging, in-place upsert + append; DoR pass/no-block/empty/malformed/
  no-scope; DoD pass, unmet criteria, missing/red checks, approval semantics
  (latest review per author wins; dismissed ignored), deploy smoke.
- 2026-06-09: runner integration: DoR-failing item routed, not dispatched.

## Decisions

- Block format exactly as specced (`<!-- loopdog:acceptance-criteria -->` fenced
  checklist). Tagging: `(test: <path>)` or `(manual)` suffix per criterion; an
  UNTAGGED criterion is malformed → **fail closed** (DoR blocks), because an
  untagged criterion has no validation plan.
- Scope bounds use a sibling `<!-- loopdog:scope -->` block; DoR requires it
  non-empty.
- DoD treats `manual:` criteria as strictly as `test:` ones — both must be
  checked. Who may check them differs (CI flips test-tagged boxes objectively;
  the intent-diff reviewer 0043 flips manual ones) but the gate doesn't trust
  an unchecked box of either kind.
- Review approval semantics: latest non-pending review per author decides that
  author's stance; DISMISSED reviews drop out; any standing CHANGES_REQUESTED
  blocks; ≥1 APPROVED required.

## Risks / Rollback

If criteria parsing is brittle, gates misfire (block good work or pass bad). Keep
the marker format simple and validated; default to *blocking* on parse failure
(fail closed), never passing.

## Final Summary

DoR/DoD are machine-checkable in `@loopdog/core/gates/`: a deterministic,
fail-closed criteria marker-block parser (with render/upsert for grooming to
write through), the DoR predicate (criteria + per-criterion validation tags +
scope) with `needs-grooming` routing, and the DoD predicate (all criteria
checked + required checks green + standing approval + optional deploy smoke).
Wired into the runner behind `GateConfig` and fully unit-tested.
