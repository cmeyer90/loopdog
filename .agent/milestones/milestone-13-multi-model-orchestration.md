# Milestone 13: Multi-Model Orchestration

Status: planned

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
| 0054 | planned | task/0054-cross-provider-review-policy | Cross-Provider Review Policy | Config for which provider reviews which implementer, per tier. |
| 0055 | planned | task/0055-ensemble-and-judge | Ensemble & Judge on `tier:core` | Dual-attempt + judge selection for high-risk tickets. |
| 0056 | planned | task/0056-outcome-driven-routing | Outcome-Driven Routing | Route task types to the stronger model using telemetry. |
| 0057 | planned | task/0057-cost-quality-routing-config | Cost/Quality Routing Config | Adopter knobs trading cost against quality per loop/tier. |

## Definition Of Done

- Cross-provider review pairings are configurable per risk tier.
- `tier:core` tickets can run dual-attempt with a judge selecting the result.
- Routing decisions are backed by logged per-model outcomes and are configurable.
- Adopters can tune the cost/quality trade-off without code changes.

## Verification Log

Add dated entries as tasks land.
