# Milestone 13: Multi-Model Orchestration

Status: verified

> Background: [Looper Architecture](../../docs/architecture.md) — "Multi-model
> orchestration." Builds on the provider abstraction (M05) and telemetry (M12).

## Objective

Go beyond single-provider selection: ensemble-with-judge on high-risk tickets,
outcome-driven routing that sends task types to the stronger model, and explicit
cross-provider review policy — so looper exploits model diversity where it pays.

## Guiding Decisions

- Cross-model review is the default high-ROI use (wired in M10); this milestone
  adds the advanced patterns on top.
- Ensemble (dual-attempt + judge) is expensive — reserved for `tier:core`
  high-value tickets.
- Routing is driven by logged outcomes (M12), not hunches, and is configurable.
- All orchestration stays vendor-neutral: adding a provider needs no engine
  changes.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0054 | verified | task/0054-cross-provider-review-policy | Cross-Provider Review Policy | Config for which provider reviews which implementer, per tier. |
| 0055 | verified | task/0055-ensemble-and-judge | Ensemble & Judge on `tier:core` | Dual-attempt + judge selection for high-risk tickets. |
| 0056 | verified | task/0056-outcome-driven-routing | Outcome-Driven Routing | Route task types to the stronger model using telemetry. |
| 0057 | verified | task/0057-cost-quality-routing-config | Cost/Quality Routing Config | Adopter knobs trading cost against quality per loop/tier. |

## Definition Of Done

- [x] Cross-provider review pairings are configurable per risk tier
  (review_policy.by_tier + implementer-exclusion enforced in reviewerFor).
- [x] `tier:core` tickets run dual-attempt with a judge selecting the result
  (ensemble fan-out → looper-winner verdict → winner advance, loser retired).
- [x] Routing is backed by logged per-model outcomes with sample floors and is
  configurable (routing.mode/min_samples; explainable reasons per choice).
- [x] Cost/quality tuning is pure config (routing.prefer + pins), no code.

## Verification Log
- 2026-06-09: all tasks verified; 180 tests green repo-wide (guards, behavioral
  parks with retryAfter holds, telemetry aggregation, routing, review pairing,
  and the three-tick tier:core ensemble on fakes).
