# 0057 Cost/Quality Routing Config

Status: planned  
Branch: task/0057-cost-quality-routing-config

## Goal

Give adopters one set of declarative knobs — per loop and per risk tier — that
trade **cost/quota against quality**: which backend implements, whether to spend
on cross-provider review or ensemble, and how aggressively to escalate to a
stronger model. The knobs resolve to a concrete dispatch plan with **no code
changes**, and the same data the outcome router (0056) consumes is exposed so a
chosen policy is auditable.

## Background

Part of [Milestone 13](../milestones/milestone-13-multi-model-orchestration.md):
"Adopters can tune the cost/quality trade-off without code changes." This task is
the **policy/config layer** that sits over the three mechanism tasks of M13 —
cross-provider review policy (0054), ensemble & judge (0055), and outcome-driven
routing (0056). Those decide *how* to review/ensemble/route; **0057 owns the
single config surface and the resolver** that turns an adopter's cost/quality
preference into the choices those mechanisms execute, and reconciles them when
they conflict. See [architecture](../../docs/architecture.md) "Generic-ness, in
three plugin systems" (providers selectable per loop), "Multi-model
orchestration," and "Observability, cost & safety" (telemetry feeds routing).

It builds on existing primitives, not new ones: the per-loop `backend:` field
(M05 · 0023), the budget/kill-switch pre-flight (M12 · 0050) and quota (0075),
the run-record cost ledger (0012), per-provider outcome telemetry (0053), and the
risk tiers `tier:safe`/`tier:core` that already gate graduated auto-merge (0045).
This task adds config + a pure resolver; it changes no backend and no engine
behavior beyond reading the resolved plan.

## Scope

- A `routing:` config block in `looper.yml` (validated in `@looper/config`) plus a
  `routing:` override stanza permitted in a per-loop `loop.yml` (strictest/most
  specific wins, same merge precedence as budgets in 0050).
- A pure **`resolveRoutingPlan(loop, tier, config, outcomes?) → RoutingPlan`** in
  `@looper/core` that turns the knobs into a concrete, deterministic plan:
  implementer backend, whether/which reviewer, whether to ensemble, escalation
  policy — with costs annotated.
- A small **`quality_floor` / `cost_ceiling`** preset vocabulary so adopters pick
  an intent (`economy` | `balanced` | `quality`) without hand-wiring every flag.
- Reconciliation rules when knobs conflict with budget/quota verdicts (0050/0075)
  and with the mechanism defaults (0054/0055/0056).
- Surfacing the resolved plan + its rationale in the run record so `looper status`
  / run reporting (M16 · 0052) can show *why* a given backend/review path ran.

### Technical detail

**Lands in:** config schema in `@looper/config` (`config/src/schema/`); the pure
resolver + `RoutingPlan` type in `@looper/core` (`core/src/routing/`, a new focused
folder — not a dumping ground); the call site is the runtime pipeline
(`runtime/src/pipeline/`) where it composes the brief and picks the backend, after
the pre-flight gate (0050/0075) and before dispatch (M05 · 0073). No new package,
no new IO port — outcomes come from the telemetry sink (0053), spend from the
run-record ledger (0012).

**Config (`looper.yml`), validated by zod:**

```yaml
routing:
  preset: balanced            # economy | balanced | quality — sets the defaults below
  per_tier:
    safe:                     # tier:safe — cheap by default, low blast radius
      implementer: cheapest   # cheapest | strongest | <backend-name> | auto
      review: skip            # skip | cross_provider | same_provider | <backend-name>
      ensemble: false
    core:                     # tier:core — quality-biased, human-gated at merge
      implementer: strongest
      review: cross_provider  # the M13 default high-ROI use (0054)
      ensemble: opt_in        # opt_in | always | never — gates 0055 dual-attempt
  escalation:
    on_review_changes: stronger_model   # off | stronger_model | human
    max_escalations: 1                  # cap escalations per item (cost guard)
  cost_ceiling:
    per_item_dispatches: 4    # hard cap on dispatches one item may consume
    prefer_quota_backend: codex   # tie-break toward the backend with quota headroom
```

Per-loop override (`.looper/loops/<name>/loop.yml`) may carry a `routing:` stanza
with the **same shape**; the resolver deep-merges `loop` over repo `per_tier[tier]`
over `preset` defaults. A `loop.yml`'s explicit `backend:` (0023) is honored as the
implementer unless `routing.implementer` is set, in which case routing wins and the
literal `backend:` is treated as the fallback when `auto`/`strongest` can't resolve.

**`RoutingPlan` (the resolver output, consumed by the pipeline):**

```ts
type Backend = 'claude' | 'codex' | 'self-hosted';
interface RoutingPlan {
  implementer: Backend;
  review: { mode: 'skip' | 'review'; reviewer?: Backend };   // reviewer ≠ implementer when cross_provider
  ensemble: { enabled: boolean; attempts: number; judge?: Backend };  // attempts>1 ⇒ 0055
  escalation: { onChanges: 'off' | 'model' | 'human'; nextBackend?: Backend; remaining: number };
  estimatedDispatches: number;   // ≤ cost_ceiling.per_item_dispatches; used by 0050 to pre-check
  rationale: string[];           // human-readable: which knob/telemetry picked each choice
}
```

**Resolver algorithm (pure, deterministic, telemetry-optional):**

1. Resolve the effective knob set: `preset` → `per_tier[tier]` → `loop.routing`
   (later overrides earlier).
2. Map symbolic backends (`cheapest`/`strongest`/`auto`) to concrete ones:
   `cheapest` = lowest cost-per-success from outcomes (0053), default subscription
   over self-hosted/API; `strongest` = highest success/quality score from outcomes;
   `auto` = delegate to the outcome router (0056) for *this task type*. With **no
   telemetry yet**, fall back to a static capability ranking from backend metadata
   (M05 · 0019 capabilities) so day-one behavior is defined and deterministic.
3. Resolve `review`: `cross_provider` ⇒ reviewer = any healthy backend ≠
   implementer (this is the input 0054 consumes for its pairing policy);
   `same_provider`/`<name>` set explicitly; `skip` ⇒ no review dispatch.
4. Resolve `ensemble`: `always` ⇒ attempts=2 + judge; `opt_in` ⇒ attempts=2 only
   if the item carries `looper:ensemble` (operator opt-in) **and** budget allows;
   `false`/`never` ⇒ attempts=1. Judge backend defaults to a third/neutral backend
   when available, else the reviewer.
5. Compute `estimatedDispatches` = implement(×attempts) + review(0|1) +
   judge(0|1) and **clamp the plan to `cost_ceiling.per_item_dispatches`** by
   shedding the cheapest-value option first (ensemble → review), recording the
   shed in `rationale`.
6. Emit `rationale` for every non-default choice.

**Reconciliation with budget/quota (the load-bearing edge).** Routing is a
*preference*; the pre-flight guard (0050/0075) is *authority*. Order: the pipeline
resolves the plan, then the budget/quota gate runs with `estimatedDispatches`.
If the gate denies the full plan, the pipeline **degrades** the plan one rung
(drop ensemble, then drop review) and re-checks, rather than parking outright —
so a quality-biased loop still ships *something* under pressure instead of
stalling. If even the bare implement dispatch is denied, the item parks per 0050
(unchanged). `cost_ceiling.prefer_quota_backend` only breaks ties among
otherwise-equal backends; it never overrides an explicit `<backend-name>`.

**Presets** are just named default bundles the schema expands at load time
(`economy` = cheapest/skip/never + escalation off; `balanced` = the YAML above;
`quality` = strongest/cross_provider/opt_in + escalate-to-stronger). Explicit
`per_tier`/loop keys always override the preset; the preset only fills unset keys.

**Edge cases:** (a) `strongest`/`cheapest` with zero telemetry → static capability
fallback (deterministic, documented); (b) only one backend configured → `review:
cross_provider` degrades to `skip` with a rationale note, never errors; (c)
`tier:core` + `ensemble: always` exceeding `per_item_dispatches` → ensemble is
clamped and rationale records it (cost ceiling wins over quality intent — the
adopter set both, the cheaper constraint binds); (d) self-hosted/API backend has
no subscription quota but does have `usd` cost → `cheapest` must compare on the
common axis (cost-per-success), not raw dispatch count; (e) per-loop `backend:` and
`routing.implementer` both set → routing wins, with a config **warning** (not error)
that `backend:` is now only the fallback; (f) unknown backend name in any knob → a
config validation **error** (fail at load, not at dispatch).

## Out Of Scope

- The cross-provider **pairing** policy itself (which provider reviews which, per
  tier) — that mechanism is 0054; 0057 only emits its `cross_provider` input.
- The dual-attempt + **judge selection** mechanism — that is 0055; 0057 only sets
  the `ensemble` flag/attempts it consumes.
- The **outcome router** that scores task-type→model from telemetry — that is 0056;
  `auto`/`strongest`/`cheapest` delegate to or read from it.
- Collecting/storing the outcome telemetry — that is 0053; this task only reads it.
- The budget/quota/kill-switch gate internals (0050/0075); risk-tier assignment and
  graduated auto-merge (0045). This task consumes the existing `tier:*` labels.
- Any CLI command surface beyond exposing the resolved plan in the run record for
  reporting (M16 · 0052/0069).

## Acceptance Criteria

- [ ] A `routing:` block in `looper.yml` (and a per-loop `routing:` override)
      validates via zod; an unknown backend name is a load-time error.
- [ ] `resolveRoutingPlan` is pure and deterministic: same inputs (config, tier,
      outcomes) → identical `RoutingPlan`, proven by a table-driven unit test.
- [ ] Per-tier defaults differ as specified: `tier:safe` resolves cheap/skip/no-
      ensemble by default; `tier:core` resolves strongest/cross-provider review.
- [ ] `preset` fills only unset keys; explicit `per_tier`/loop keys override it.
- [ ] `cheapest`/`strongest`/`auto` map to concrete backends from telemetry (0053)
      when present, and to a deterministic static ranking when telemetry is absent.
- [ ] `estimatedDispatches` never exceeds `cost_ceiling.per_item_dispatches`; an
      over-budget plan sheds ensemble then review (recorded in `rationale`) before
      parking.
- [ ] When the budget/quota gate (0050/0075) denies the full plan, the pipeline
      degrades one rung and re-checks rather than parking immediately.
- [ ] The resolved plan + `rationale` are written to the run record so reporting
      (0052) can show why a backend/review/ensemble path was chosen.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add the `routing:` schema (+ `preset` expansion, defaults) to `@looper/config`.
- [ ] Define `RoutingPlan` + `resolveRoutingPlan` in `@looper/core` (`core/src/routing/`).
- [ ] Implement symbolic-backend resolution (telemetry-driven + static fallback).
- [ ] Implement the cost-ceiling clamp + value-ordered shedding.
- [ ] Wire the resolver into the runtime pipeline before dispatch; pass
      `estimatedDispatches` to the pre-flight gate (0050) and implement the
      degrade-one-rung-on-deny path.
- [ ] Record the resolved plan + rationale in the run record (0012) for reporting.
- [ ] Document the knobs + presets in the config reference (M14) if behavior is new.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake backends + recorded outcome telemetry) — **no real quota**.

```bash
pnpm vitest run packages/core packages/config packages/runtime
# unit (core): resolveRoutingPlan table — preset×tier×override → expected RoutingPlan
#   cheapest/strongest with recorded outcomes vs. empty telemetry (static fallback)
#   cost-ceiling clamp sheds ensemble→review; single-backend degrades cross_provider→skip
# unit (config): valid routing block parses; unknown backend errors; backend+implementer warns
# scenario (runtime): tier:core item resolves strongest+cross_provider; budget-denied full
#   plan degrades one rung then dispatches; resolved plan appears in the run record
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the preset vocabulary + what each expands to; the static capability
ranking used when telemetry is absent; the shed order under the cost ceiling
(ensemble before review); the routing-vs-`backend:` precedence (routing wins,
warn); and the degrade-vs-park policy when budget denies the full plan.

## Risks / Rollback

- **Conflicting authorities** (routing preference vs. budget/quota vs. mechanism
  defaults 0054/0055/0056) could produce surprising behavior; the explicit order —
  budget is authority, routing degrades, mechanisms execute the resolved plan — must
  be tested at the boundaries, not just in isolation.
- A quality-biased preset could quietly burn quota via ensemble/escalation; the
  `per_item_dispatches` ceiling + `max_escalations` are the hard caps and must bind
  even when `preset: quality` is set.
- Telemetry-driven `strongest`/`cheapest` is only as good as 0053's data; the static
  fallback keeps day-one deterministic, and `rationale` makes every pick auditable.
- Rollback: routing is additive and optional — omitting the `routing:` block reverts
  to the literal per-loop `backend:` (0023) with no review/ensemble, i.e. exactly
  today's behavior. Disabling is config-only, no code revert.

## Final Summary

Fill this in before marking verified.
