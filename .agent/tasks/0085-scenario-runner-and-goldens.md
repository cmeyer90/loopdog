# 0085 Scenario Runner & Golden Assertions

Status: planned  
Branch: task/0085-scenario-runner-and-goldens

## Goal

A declarative scenario runner that drives the **real** controller over the fake
GitHub (0083) and fake/replay backends (0084) through a scripted sequence of
events and sweeps, then asserts the resulting GitHub labels/PRs/comments, durable
plan, and run-records against a **golden snapshot** — so whole loops are provable
end-to-end, offline, deterministically, with zero quota, and any behavioral drift
fails CI.

## Background

Part of [Milestone 18](../milestones/milestone-18-test-and-simulation-harness.md)
(tier 3, "scenario"). This is where the harness pieces compose: 0083 gives the
in-memory `GitHubPort`, 0084 gives scripted/replay `Backend`s, and this task adds
the driver + assertion layer that runs the unmodified `runtime` controller against
them. It exercises the transition runner (0012), dispatch→ingest correlation
(0073), the events-vs-sweep handoff (M02 · 0076), and gates (M03 · 0014). Lives in
the dev-only `@looper/testing` package (`scenario/` + `fixtures/`). See
[codebase](../../docs/codebase.md) "Testing strategy" and
[architecture](../../docs/architecture.md) "Triggering."

## Scope

- A scenario format: initial repo state + a sequence of `event`/`sweep`/`tick`
  steps the runner replays against the real controller over the fakes.
- A driver that injects the fakes into the `runtime` composition root, delivers
  each step, and lets the pipeline run to quiescence per step.
- A golden snapshotter: serialize end-state (labels, PRs, comments, plan files,
  run-records) into a stable, redacted, deterministically-ordered artifact.
- Golden compare with a one-flag **update mode**; readable diffs on mismatch.
- A starter library of golden scenarios covering the built-in loops' happy paths
  + key edge cases.

### Technical detail

**Lands in:** `@looper/testing` — `src/scenario/` (runner, format, snapshot,
golden-store) and `src/fixtures/` (canned scenarios + their goldens). Imports the
real `@looper/runtime` controller and the `@looper/core` port types; injects the
0083 `FakeGitHub` and 0084 fake/replay `Backend`s. No production package depends on
`testing`.

**Scenario file** — `*.scenario.yml` (also constructable in TS via a builder):

```yaml
name: groom-then-implement-happy-path
seed: 42                              # → deterministic ids/timestamps (0083) + brief hashes
loops: [groom, implement]             # built-in loop assets loaded from runtime
backend: { groom: fake, implement: fake }   # fake | replay:<cassette> (0084)
initial:
  issues:
    - { number: 142, title: "Add /health endpoint", labels: [looper:state/new],
        author: { login: alice, association: COLLABORATOR } }
steps:
  - event: { kind: issues, action: labeled, issue: 142, label: looper:state/new }
  - sweep: {}                          # cron reconcile pass (carries token→token handoff)
  - event: { kind: pull_request, action: opened, pr: 7 }   # provider agent's PR (0073)
  - sweep: {}
expect_golden: groom-then-implement-happy-path
```

Step kinds: `event` (deliver one GitHub event from the fake's queue or a synthetic
one), `sweep` (run one cron reconcile pass over all loops), `tick` (advance the
injected clock — pairs with 0086's deterministic clock for time-based
transitions/leases). After each step the driver **runs the pipeline to
quiescence**: it loops `controller.handle(step)` then drains any *self-triggered*
follow-on events the fake enqueued, honoring the `GITHUB_TOKEN`-no-retrigger rule
(so token→token handoffs only advance on the next explicit `sweep`, exactly as
production behaves). A per-step max-iteration guard prevents an accidental infinite
loop from hanging CI.

**Driver wiring:** build the runtime composition root with injected ports —
`{ github: fakeGitHub, backends: fakeBackends, plans: <in-memory PlanStore over
fakeGitHub>, adapters: <stub generic adapter>, clock: fakeClock }`. The controller
code is unchanged; only the leaves are fakes. Loop assets come from
`runtime`'s built-in `templates/loops/*` so scenarios test the shipped briefs.

**Golden snapshot** — a single deterministic artifact per scenario
(`fixtures/goldens/<name>.golden.yml` or `.json`), serialized in canonical order:

```yaml
labels: { "142": [looper:state/in-review] }
prs:
  - { number: 7, head: "looper/implement/142-run_91c", base: main,
      trailer_run: run_91c, links_issue: 142, state: open }
comments:
  - { target: issue/142, author: looper, body_digest: "sha256:…" }   # body redacted→digest
plan:
  ".agent/tasks/0142-add-health-endpoint.md": "sha256:…"             # plan files by content digest
runs:
  - { run_id: run_91c, loop: implement, item: 142,
      outcome: { status: done, transition: "ready-for-agent->in-review" },
      steps: [claim, compose, dispatch, ingest, gate, write] }       # step *kinds* only
```

**Determinism/redaction rules** (the heart of stable goldens): (a) all ids and
timestamps come from the seeded fake (0083) and injected clock; (b) free-text
(comment/PR bodies, composed briefs, plan prose) is reduced to a `sha256` digest so
goldens assert *structure + which content*, not brittle wording — a `--show-bodies`
debug flag prints full text on diff; (c) collections sorted by stable key
(issue/PR number, run_id); (d) volatile fields (durations, absolute wall-clock,
tokens) are dropped or normalized; (e) backend nondeterminism is removed because
the fake/replay backend (0084) is itself deterministic.

**Golden store + update mode:** `LOOPER_UPDATE_GOLDENS=1` (or `vitest -u`) rewrites
goldens from the observed end-state; default mode compares and, on mismatch, throws
with a unified, field-level diff (added/removed/changed keys). A missing golden in
compare mode is a failure, not an auto-create, so new scenarios are reviewed.

**Public API** (consumed by 0086 simulation and 0087 CI tasks):

```ts
runScenario(spec: Scenario, opts?: { update?: boolean; seed?: number })
  : Promise<ScenarioResult>           // { endState, runs, diff? }
loadScenario(path: string): Scenario
assertGolden(result: ScenarioResult, name: string, opts?): void
```

**Edge cases to cover with starter scenarios:** (1) groom→implement happy path
(above); (2) **idempotent re-delivery** — deliver the same `pull_request.opened`
event twice → single ingest, identical golden (proves 0073 idempotency); (3)
**token→token handoff needs a sweep** — an event step alone does not advance a
controller-written transition; the following `sweep` does (proves 0076 + the no-
retrigger rule); (4) **gate block** — DoR missing acceptance-criteria marker → item
parked, no dispatch, run-record `status: failed/escalated` (proves M03 · 0014); (5)
**replay backend** — same scenario run with `replay:<cassette>` (0084) yields the
same golden as the scripted fake. Race/storm/crash scenarios are 0086's job, built
on this runner.

## Out Of Scope

- The fake GitHub internals (0083) and backend fakes/cassettes (0084).
- Deterministic clock + fault injection + invariant checks (0086) — this task only
  provides the `tick` step hook and the runner they build on.
- CI wiring and the live smoke (0087).

## Acceptance Criteria

- [ ] A declarative scenario (initial state + event/sweep/tick steps) drives the
      **unmodified** controller over the fakes and produces a deterministic
      end-state.
- [ ] Golden snapshot captures labels, PRs, comments, plan files, and run-records,
      serialized in canonical order with free-text redacted to digests.
- [ ] Compare mode fails on drift with a readable field-level diff; update mode
      (`LOOPER_UPDATE_GOLDENS=1`) rewrites goldens; a missing golden fails in
      compare mode.
- [ ] Running the same scenario twice (same seed) yields byte-identical goldens.
- [ ] The same scenario over a `replay` backend (0084) and the scripted fake
      produces the same golden.
- [ ] Starter scenarios cover: groom→implement happy path, idempotent
      re-delivery, token→token handoff requiring a sweep, and a gate block.

## Implementation Checklist

- [ ] Define the `Scenario` type + `*.scenario.yml` schema (zod) and a TS builder.
- [ ] Implement the driver: inject fakes into the runtime root, deliver steps, run
      to quiescence with the no-retrigger rule + a max-iteration guard.
- [ ] Implement the snapshotter (canonical ordering, digesting, redaction).
- [ ] Implement the golden store: compare + update mode + readable diff.
- [ ] Author the starter scenarios and their goldens under `fixtures/`.
- [ ] Export `runScenario` / `loadScenario` / `assertGolden` for 0086 + 0087.

## Test Plan

Tests run via vitest in `@looper/testing`; all behavior uses the M18 fakes
(0083/0084) — no real quota, no network.

```bash
# run the scenario suite (self-tests of the runner + the starter scenarios)
pnpm --filter @looper/testing test
# regenerate goldens after an intended behavior change, then review the diff
LOOPER_UPDATE_GOLDENS=1 pnpm --filter @looper/testing test
```

Self-tests assert: determinism (two runs → identical golden), compare-mode failure
on an injected drift, update-mode rewrite, the no-retrigger sweep semantics, and
fake-vs-replay golden equality.

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the scenario schema, the canonical-serialization + redaction rules, the
run-to-quiescence/no-retrigger algorithm, and the golden file format/location.

## Risks / Rollback

- **Brittle goldens** (churn on every prose tweak) — mitigated by digesting
  free-text and asserting structure, not wording.
- **Hidden nondeterminism** leaking into goldens (map iteration order, time, ids)
  — mitigated by canonical ordering + seeded fakes + injected clock; a
  determinism self-test guards it.
- **Fake-vs-real drift** — scenarios can pass while production breaks if the fakes
  diverge from GitHub; the gated live smoke (0087) is the backstop.
- Rollback is low-risk: dev-only package, no shipped surface; revert the folder.

## Final Summary

Fill this in before marking verified.
