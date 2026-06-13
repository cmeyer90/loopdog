# 0056 Outcome-Driven Routing

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Route a transition's task type to the backend that has historically performed
**better on that task type**, using logged per-provider outcomes (M12 · 0053) —
turning static, config-declared backend selection (0023) into a data-driven
choice, while staying deterministic, vendor-neutral, and fully overridable.

## Background

Part of [Milestone 13](../milestones/milestone-13-multi-model-orchestration.md):
"Routing is driven by logged outcomes (M12), not hunches, and is configurable",
and "adding a provider needs no engine changes." This task is the **dynamic**
counterpart to static backend selection (0023): 0023 resolves a backend from
config precedence; 0056 inserts an optional, telemetry-fed routing step *ahead*
of that resolution and feeds its decision back through the same
`selectBackend` → `resolveAuth` → `dispatch` pipeline. It consumes the
per-provider outcome telemetry (M12 · 0053) and is bounded by the cost/quality
knobs (0057). It must not contradict static config (an explicit per-loop
`backend` override always wins). Lands in `@looper/backends` (the router, beside
the selection resolver) and `@looper/config` (the `routing` schema). See
[architecture](../../docs/architecture.md) "Generic-ness, in three plugin
systems" (point 3, providers selectable per loop) and "Observability, cost &
safety" ("Per-provider outcome telemetry feeds routing").

## Scope

- A pure **router** that, given a task type + candidate backends + an outcome
  snapshot, returns the recommended backend (or "no recommendation").
- A **task-type key**: how a transition is classified into the dimension
  outcomes are aggregated and routed by.
- **Statistical guards**: minimum sample size, a tie/uncertainty band, and a
  recency window so routing reacts to real signal, not noise.
- A `routing` **config block** (global + per-loop) to enable/disable, set
  thresholds, pin candidates, and force-disable per loop.
- **Integration**: invoke the router in the runner pre-flight ahead of
  `selectBackend` (0023); record the routing decision + its rationale in the run
  record (0012) so the CLI (M16 · 0069) can show *why* a backend was chosen.

### Technical detail

**Where it sits.** New module `@looper/backends/src/routing` (pure, IO-free —
the outcome snapshot is passed in). The runner pre-flight order becomes:
gates/authz/budget (0012) → **route (0056, optional)** → `selectBackend` (0023)
→ `resolveAuth` (0023) → `dispatch`. The router produces a *candidate
preference*; `selectBackend` still enforces static precedence, so an explicit
loop-level `backend` override beats any routing recommendation (routing only
decides among backends the operator has *allowed* to compete).

**Task-type key.** Outcomes are aggregated per `(taskType, backend)`. Derive
`taskType` deterministically from the transition + item, in this precedence:
loop's declared `task_type` (config) → the transition stage
(`implement`/`review`, as in 0023) → risk tier label (`tier:safe`/`tier:core`).
Default key = `"<loop>:<stage>"` so routing is per-loop-and-stage unless the
adopter declares a coarser/finer `task_type`.

```ts
// @looper/backends/src/routing
type TaskType = string;                 // e.g. "implement:core", "review", "dep-update"
type BackendName = "claude" | "codex" | "self-hosted";

interface OutcomeStat {                  // one (taskType, backend) cell from M12 · 0053
  taskType: TaskType;
  backend: BackendName;
  samples: number;                       // attempts in the recency window
  successRate: number;                   // 0..1: merged-without-revert / attempts
  // secondary signals (used by 0057, surfaced here for tie-breaks):
  avgFixCycles?: number; avgDurationMs?: number; avgCostUsd?: number;
}

interface RoutingDecision {
  recommended: BackendName | null;       // null → fall through to static selection (0023)
  reason: "insufficient-samples" | "below-margin" | "disabled" | "routed" | "pinned";
  considered: { backend: BackendName; samples: number; successRate: number }[];
  taskType: TaskType;
}

function route(
  taskType: TaskType,
  candidates: BackendName[],             // backends the operator allows to compete
  stats: OutcomeStat[],                  // snapshot from M12 · 0053, recency-windowed
  cfg: RoutingConfig,
): RoutingDecision;
```

**Algorithm (deterministic, explainable — no ML).**
1. If `routing.enabled` is false (loop or global) → `{ recommended: null, reason: "disabled" }`.
2. Filter `stats` to `taskType` ∩ `candidates` within the recency window.
3. Drop any candidate with `samples < routing.min_samples` (default 20). If
   fewer than 2 candidates remain → `reason: "insufficient-samples"`, recommend
   `null` (let static selection decide).
4. Rank by `successRate` desc; break ties by `avgFixCycles` asc, then
   `avgCostUsd` asc, then backend name (stable/deterministic).
5. If `(top.successRate - second.successRate) < routing.margin` (default 0.05)
   → `reason: "below-margin"`, recommend `null` (don't churn on noise).
6. Otherwise recommend the top backend, `reason: "routed"`.
- A `routing.pin` map (`taskType → backend`) short-circuits at step 1 with
  `reason: "pinned"` — an operator escape hatch that still flows through the
  decision record.

**Config schema** (`@looper/config`, validated in 0006; both levels optional):

```yaml
# looper.yml (global) — and the same block under .looper/loops/<name>/loop.yml
routing:
  enabled: true            # default false (safe-by-default; opt-in)
  min_samples: 20          # per (taskType, backend) within the window
  margin: 0.05             # required successRate lead to switch
  window: 30d              # recency window for the outcome snapshot
  candidates: [claude, codex]   # backends allowed to compete (default: all configured)
  pin: { "review": codex }      # optional hard overrides per taskType
```

Precedence mirrors 0023 (most-specific wins): loop `routing.*` overrides global
`routing.*`. Routing is **off by default** — adopters opt in once telemetry has
accumulated.

**Telemetry contract (M12 · 0053).** The router never queries GitHub; the runner
fetches a recency-windowed `OutcomeStat[]` from the telemetry source (0053) and
passes it in. `successRate` is the definitive routing metric: *merged without a
subsequent revert/rollback* over attempts in the window; secondary metrics
(`avgFixCycles`, cost, duration) are tie-breakers and inputs the cost/quality
config (0057) re-weights. If 0053 isn't yet available, the router degrades to
`reason: "insufficient-samples"` on an empty snapshot — never blocking dispatch.

**Run-record integration (0012).** The chosen `RoutingDecision` is stored on the
run record so `looper runs show` (M16 · 0069) renders "routed to codex
(taskType review: 0.91 vs claude 0.78, n=34)" — auditable, not magical.

**Edge cases.** Empty/insufficient snapshot → null (static selection). A
candidate that fails `resolveAuth` (0023) downstream → routing already chose
among allowed backends, but if the recommended backend is unauthorized, the
runner logs and falls back to static selection rather than failing pre-flight.
Single configured backend → router no-ops. A `pin` to a non-configured backend →
config validation error (0006). Routing never *adds* a backend the loop didn't
configure; it only reorders allowed candidates.

## Out Of Scope

- Producing the telemetry itself (M12 · 0053) — this task only consumes it.
- Static backend selection + auth resolution (0023); the dispatch/ingest path (0073).
- Cross-provider **review pairing** policy (0054) and ensemble/judge (0055) —
  routing chooses a single implementer backend; those are separate patterns.
- The cost/quality **weighting knobs** (0057) — 0056 exposes the secondary
  metrics and a deterministic ranking; 0057 layers the cost-vs-quality trade-off
  re-weighting on top.
- Any ML model / online learning — ranking is explicit and explainable.

## Acceptance Criteria

- [x] `route` returns the higher-`successRate` backend for a task type when both
      candidates clear `min_samples` and the lead exceeds `margin`, proven by a
      table test.
- [x] Below `min_samples` or within `margin`, `route` recommends `null` with the
      correct `reason`, and the runner falls through to static selection (0023).
- [x] An explicit per-loop `backend` (0023) and a `routing.pin` each override the
      outcome-based choice, and the override is reflected in `RoutingDecision.reason`.
- [x] `routing.enabled: false` (loop or global) disables routing entirely.
- [x] The routing decision + considered candidates are recorded on the run record
      and surfaceable via the CLI.
- [x] Adding a provider needs no router change — candidates come from config, the
      router is provider-agnostic.
- [x] An empty/missing outcome snapshot never blocks dispatch (degrades to static).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `routing` block to the `looper.yml` and `loop.yml` zod schemas
      (`@looper/config`) with validation (pin → configured backend; numeric ranges).
- [x] Implement the task-type derivation (`@looper/backends/src/routing`).
- [x] Implement the pure `route` ranker (sample/margin/recency guards, tie-breaks).
- [x] Define the `OutcomeStat`/`RoutingDecision` types and the consumption contract
      against M12 · 0053's telemetry shape.
- [x] Wire the router into the runner pre-flight (`@looper/runtime`) ahead of
      `selectBackend`, with auth-fallback to static selection; record the decision
      on the run record (0012).
- [x] Tests for ranking, guards, overrides, and degradation using the M18 fakes.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral cases use the
`@looper/testing` fakes (fake outcome snapshots, fake backends/registry, fake
GitHub) — **no real provider quota, no live telemetry**.

```bash
# unit: route() ranks by successRate; margin/min_samples guards → null + reason
# unit: tie-break order (fixCycles → cost → name); pin + disabled short-circuits
# unit: taskType derivation precedence (loop task_type → stage → tier)
# component: empty snapshot degrades to static selection (no dispatch block)
# scenario: a loop with two candidates routes implement vs. review independently,
#           and the decision appears on the run record
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

routeBackend: pins always win; static mode ignores the ledger; outcome mode
requires min_samples decided runs per candidate and picks the strictly
better success rate (deterministic tie-break), falling to the 0057
preference knob when there's no signal. Recorded scope: V1 keys outcomes by
loop (the task-type proxy); per-label task-kind keys are a post-V1 widening.

## Risks / Rollback

- **Oscillation / flapping** between backends on thin data is the main risk —
  defended by `min_samples`, the `margin` band, and the recency window; if it
  still churns, raise the thresholds or set `routing.enabled: false` (pure
  config rollback, no code change — static selection 0023 fully covers the path).
- **Bad telemetry → bad routing**: routing is opt-in and off by default, so a
  miscalibrated snapshot can't silently degrade a fresh install; a `routing.pin`
  is the immediate manual override.
- No provider quota is spent by this task in isolation (it's pre-dispatch
  selection logic), so it is safe to land and exercise entirely on fakes.

## Final Summary

Routing is data-driven and configurable: logged per-provider outcomes pick
the stronger model per loop, with sample floors, pins, and explainable
reasons on every choice.
