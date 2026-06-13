# 0055 Ensemble & Judge on `tier:core`

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

For high-value `tier:core` tickets, run a **dual-attempt ensemble**: dispatch the
implement work to **two distinct providers** in parallel, then a third
cross-provider **judge** selects the stronger PR (or rejects both). The winner
enters the normal review/merge ladder; the loser is closed. Reserved for
`tier:core` and opt-in, because it spends two-to-three times the quota of a single
attempt.

## Background

Part of [Milestone 13](../milestones/milestone-13-multi-model-orchestration.md) —
its Objective ("ensemble-with-judge on high-risk tickets") and Guiding Decision
"Ensemble (dual-attempt + judge) is expensive — reserved for `tier:core`
high-value tickets." See [architecture](../../docs/architecture.md) "Multi-model
orchestration" and "The verification ladder (trust)": a judge that picks between
two lineages is itself a cross-provider check, so it must never be the same
provider as either implementer (the rubber-stamp rule).

This builds directly on existing primitives and adds **no new package**: the
execution-backend interface + dispatch/ingest correlation (M05 · 0073), the
stateless transition runner (0012), tier derivation (0045 · `deriveTier`), the
cross-model reviewer-selection helper and verdict block (0042), the intent-diff
schema (0043), and per-provider outcome telemetry (0053). The judge is a
specialized application of the cross-model review cell (0042). Ensemble is the
`tier:core` companion to single-attempt routing (0056) and the cost/quality knobs
(0057), and is governed by the cross-provider review policy (0054). It lands as a
built-in loop asset plus a pure decision helper in `@looper/runtime` /
`@looper/core`.

## Scope

- An **ensemble implement transition**: when an item is `tier:core` **and**
  ensemble is enabled, dispatch the implement brief to two distinct providers in
  parallel under one parent run, each on its own correlated branch/PR.
- A **judge step**: a third provider (≠ both implementers) does a comparative
  intent-diff over both PRs against the acceptance criteria and emits a structured
  selection verdict (`winner` | `tie` | `reject-both`).
- **Deterministic selection + cleanup**: the controller (not the model) reads the
  judge verdict, advances the winning PR into the review ladder, closes the losing
  PR/branch, and records the ensemble outcome (both attempts + the choice) to
  telemetry (0053).
- A **fallback** when only one distinct provider is available, when an attempt
  yields no PR within the lease, or when the judge rejects both — degrade safely,
  never silently merge.

### Technical detail

**Package(s):** the loop ships in `@looper/runtime` as
`templates/loops/implement-ensemble/` assets (`loop.yml`, `prompt.md`, and a
`judge.prompt.md` brief), scaffolded by `looper init`. The pure selection logic
(`decideEnsemble`) lands in `@looper/core` (`core/src/ensemble/select.ts`,
exported from `core/index.ts`). Parallel dispatch, correlation, and cleanup wire
through `@looper/runtime` (pipeline) reusing the `Backend` port (M05 · 0019),
correlation (0073), and tier derivation (0045). No new package; no model API
calls on the controller — every implement and judge step is a dispatched
provider-cloud task.

**Eligibility gate (pre-flight, before any dispatch).** In the runner pre-flight
(0012): ensemble runs only when **all** hold, else fall back to single-attempt
implement (0009/0056):
- `deriveTier(...) === 'core'` (0045), and
- `looper.yml` `ensemble.enabled: true` (or the loop's `gates.ensemble: true`), and
- the budget/quota gate (0050/0075) has headroom for **N parallel attempts +1
  judge** (ensemble is counted as N+1 dispatches against quota — never starts a
  second attempt it cannot pay for), and
- at least **two** distinct providers expose `capabilities.can_implement` and one
  more (possibly reused after attempts complete) exposes `can_review`.

**Config (`looper.yml`, schema in `@looper/config` · 0006):**

```yaml
ensemble:
  enabled: false                 # opt-in; off by default (cost)
  attempts: 2                    # number of parallel implementers (default/only V1 value: 2)
  implementers: [claude, codex]  # optional explicit set; else first N distinct can_implement
  judge: cross-model             # sentinel: resolve ≠ both implementers (reuses 0042 selection)
  tie_breaker: judge-rerun       # judge-rerun | escalate (on `tie`) — default escalate
  on_reject_both: escalate       # escalate | retry-once
```

**Run-record shape (extends 0012).** One **parent** ensemble run with child
attempt runs, so telemetry (0053) attributes the win to a provider:

```yaml
run_id: run_e7a                  # parent ensemble run
loop: implement-ensemble
kind: ensemble
attempts:
  - { run_id: run_e7a.1, backend: claude, pr: 142, status: opened }
  - { run_id: run_e7a.2, backend: codex,  pr: 143, status: opened }
judge: { run_id: run_e7a.j, backend: codex_or_claude≠implementers, verdict_ref: <comment> }
outcome: { selected: run_e7a.1, pr: 142, loser_pr: 143, decision: winner }
```

**Parallel dispatch + correlation.** The pipeline dispatches both attempt briefs
in the same invocation, each branch `looper/implement-ensemble/<issue>-<run_id>`
with its own `looper-run:` trailer (0073). Because provider work is async,
dispatch returns immediately; both PRs are ingested by **later** invocations
(event or sweep). The runner does not block — ensemble state is "awaiting
attempts" until both correlated PRs (or lease timeouts) are in. The cron sweep
(0073 timeout path) escalates a stranded attempt; a dispatched judge is only fired
once **all** non-timed-out attempts have produced a PR.

**Judge step.** Once ≥2 attempts have PRs, the pipeline composes `judge.prompt.md`
and dispatches it via the cross-model selection helper (0042) to a provider
distinct from **both** implementers (resolution: `ensemble.judge`/`review.backend`,
else first `can_review` provider not in the implementer set; if none distinct →
escalate, never let an implementer judge its own attempt). The judge brief
injects: both PR diffs/refs, the durable plan, and the parsed acceptance criteria
(both `test:` and `manual:`), and asks the judge to, per criterion, say which
PR(s) satisfy it (with file/line evidence), then emit a fenced verdict block the
runtime parses:

```yaml
# looper:ensemble-verdict
verdict: winner | tie | reject-both
winner: 142            # PR number, required when verdict=winner
rationale:
  - { criterion: ac-1, satisfied_by: [142], note: "143 missing the 400 path" }
findings: [ { pr: 143, severity: blocker, note } ]
```

The judge must defer to CI on `test:` criteria (it confirms presence/coverage, not
pass — CI is rung 2, the gate looper cannot edit) exactly as the reviewer does in
0042.

**Deterministic selection — `decideEnsemble(verdict, attempts, config)` (core, IO-free):**

```ts
type EnsembleAction =
  | { action: 'advance'; winner: PrRef; closeLosers: PrRef[] }
  | { action: 'escalate'; reason: string }       // tie/reject-both/no distinct judge
  | { action: 'retry'; brief: string };          // on_reject_both: retry-once only
```

The **controller decides, the model only proposes**:
- `verdict: winner` with a `winner` matching an open attempt PR → `advance` that
  PR; the others are losers.
- `verdict: tie` → `tie_breaker`: `escalate` (default) or one judge-rerun, then
  escalate (never auto-pick on a tie — fail closed to a human).
- `verdict: reject-both` → `on_reject_both`: `escalate` (default) or a single
  combined retry brief carrying the judge findings, then escalate.
- Malformed/missing verdict block, or a `winner` that names a non-existent/closed
  PR → **fail closed**: `escalate` (matching 0043's parse-failure stance).

**Advance + cleanup.** On `advance`: the winning PR enters the **normal review
ladder unchanged** — it still gets the cross-provider review (0042/0043), DoD gate
(0014), and graduated auto-merge (0045); ensemble does **not** bypass any rung
(the judge picks the *better candidate*, it does not approve merge). The winner's
label moves to the review loop's `from` state (`in-review`); the loser PR(s) are
**closed with a comment** (`looper-ensemble-loser: <parent_run_id>`) and their
branches deleted, idempotently (guard on already-closed). The parent run records
`selected`/`loser_pr`/`decision`; telemetry (0053) logs a per-provider win/loss so
outcome-driven routing (0056) learns which provider wins `tier:core` tickets.

**Idempotency.** The parent ensemble key is `(loop, item, from-state)` (0012);
re-invocation never re-dispatches attempts that already have correlated PRs, never
re-fires the judge once a verdict is ingested, and never re-closes a closed loser.
Event↔sweep races are safe per the 0012/0073 guarantees.

**Edge cases:** only one distinct provider → fall back to single-attempt implement
(no ensemble); one attempt times out (sweep) → judge over the survivor degrades to
a normal single-attempt review (not a comparison), or escalates if zero attempts
land; both attempts identical diff → judge may `tie` → tie_breaker; budget
exhausted mid-ensemble → no new dispatch, park/escalate per resilience (M19),
never leave one PR merged and one orphaned.

## Out Of Scope

- Tier derivation itself (0045 · `deriveTier`) — consumed here.
- The cross-model reviewer-selection helper and the per-criterion review verdict
  schema (0042/0043) — reused; the judge is a comparative application, not a new
  reviewer.
- The actual review/merge of the winning PR (0042/0043/0045) — the winner enters
  the existing ladder untouched.
- Single-attempt outcome-driven routing (0056) and the cost/quality knobs (0057);
  the cross-provider review *pairing* policy (0054).
- Backend dispatch internals / capability metadata (M05 · 0019/0073); quota
  modeling (0075).

## Acceptance Criteria

- [x] Ensemble runs **only** when the item is `tier:core`, `ensemble.enabled`, and
      ≥2 distinct `can_implement` providers exist with budget for N+1 dispatches;
      otherwise the runner falls back to single-attempt implement (no double spend).
- [x] Two implement briefs are dispatched in parallel under one parent run, each on
      a distinct correlated branch/PR (0073), without blocking the invocation.
- [x] The judge provider is distinct from **both** implementers; if none distinct
      is available the run escalates (no self-judging).
- [x] The judge emits a parseable `looper:ensemble-verdict` block; the controller
      (not the model) selects the winner deterministically.
- [x] `verdict: winner` advances the winning PR into the normal review ladder and
      closes the loser PR(s) + branches idempotently; the winner still passes every
      ladder rung (no merge shortcut).
- [x] `tie`, `reject-both`, a malformed verdict, or a winner naming a missing PR
      **fail closed** to escalation (or a single bounded retry per config) — never
      auto-advance an unjudged PR.
- [x] A timed-out attempt is detected by the sweep and the ensemble degrades or
      escalates rather than stranding a PR.
- [x] Re-invocation is idempotent (no re-dispatch, no re-judge, no re-close).
- [x] The parent + per-attempt outcomes are recorded to telemetry (0053) with the
      winning provider attributed.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `ensemble` config block + validation to `@looper/config` (0006).
- [x] Implement `decideEnsemble` + the `EnsembleAction` types and verdict parser in
      `@looper/core` (`core/src/ensemble/`); fail-closed on tie/reject/parse error.
- [x] Author `templates/loops/implement-ensemble/{loop.yml,prompt.md,judge.prompt.md}`
      in `@looper/runtime` (parallel implement brief + comparative judge brief +
      `looper:ensemble-verdict` contract).
- [x] Wire the ensemble pre-flight gate (tier + enabled + provider count + budget)
      into the runner pipeline (0012), falling back to single-attempt otherwise.
- [x] Implement parallel dispatch + dual correlation + the "await both then judge"
      state via `Backend.dispatch` and correlation (0073).
- [x] Implement winner advance into the review ladder + idempotent loser
      close/branch-delete + parent run-record/telemetry write (0053).
- [x] Register the loop in the built-in assets and `looper init` scaffold.
- [x] Add golden scenario + simulation tests (below).

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backends from `@looper/testing`) — no real quota,
deterministic, offline.

```bash
# from repo root, run the affected suites
pnpm -F @looper/core test
pnpm -F @looper/runtime test
# unit (core): decideEnsemble → winner advances + losers closed; tie→escalate;
#   reject-both→escalate/retry-once; malformed/missing-PR verdict→fail closed.
# scenario (fakes): tier:core + enabled + 2 providers → 2 PRs → distinct judge →
#   winner enters review ladder, loser PR closed; outcome logged per provider.
# scenario (fakes): only one distinct provider → falls back to single-attempt.
# scenario (fakes): no-criteria / judge returns no block → escalate, never advance.
# simulation: one attempt's PR dropped → sweep degrades/escalates, no strand;
#   double-invocation → no re-dispatch, no re-judge, no re-close (idempotent).
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

- Ensemble is loop config (ensemble.enabled + optional judge backend),
  VALIDATED to tier:core only (expensive by design).
- Mechanics: dispatch the same brief to two distinct providers with suffixed
  run ids (distinct branches), persist both handles; when BOTH attempts have
  PRs, dispatch the judge (comment expectation) instructed to compare against
  the criteria and emit `looper-winner: #N`; the winner advances + is
  labeled, the loser is labeled looper:abandoned with an explanatory comment;
  all markers resolve. No winner verdict → fail-closed escalation.
- Judge backend precedence: ensemble.judge → review_backend → the opposite
  provider.

## Risks / Rollback

- **Self-judging rubber-stamp** (judge == an implementer) silently biases
  selection — guarded by the distinct-provider assertion (reusing 0042) and a
  scenario test; escalate rather than fall back to a same-lineage judge.
- **Quota blow-out**: ensemble is N+1 dispatches; an always-on ensemble would
  drain a subscription. Defense: off by default, `tier:core`-only, gated on
  budget headroom for the full N+1 before the first dispatch.
- **Orphaned/double-merged PRs**: a crash between selecting the winner and closing
  the loser could leave two open PRs. Defense: deterministic, idempotent
  advance/close keyed on the parent run (0012); the loser-close is replayable by
  the sweep.
- **Judge bias bypassing the ladder**: the judge only *selects a candidate* — the
  winner still runs every verification-ladder rung (0042/0043/0045), so a bad judge
  pick is bounded by CI (rung 2) and review (rung 3), not auto-merged.
- Rollback: the loop is data — set `ensemble.enabled: false` (or disable the loop
  asset) to revert every `tier:core` item to single-attempt implement (0009/0056)
  with no code change; no item is stranded, only un-ensembled.

## Final Summary

tier:core tickets can run dual-attempt + judge end-to-end: fan-out across
two providers, judge comparison with a machine-readable winner verdict,
winner promotion and loser retirement — proven by the three-tick ensemble
test on fakes.
