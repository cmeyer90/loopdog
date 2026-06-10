# Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions)

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "Execution
> model: orchestrate provider cloud agents over GitHub" and "Verified provider
> capabilities." This is the milestone that makes looper subscription-native.
> Lands in `@looper/backends` (interface in `@looper/core`) — see
> [Codebase Layout](../../docs/codebase.md).

## Objective

Define one execution-backend contract — dispatch a work cell with a brief, then
ingest its resulting PR — and implement it for the **Claude** and **Codex**
subscription cloud agents (the primary path) plus an optional **self-hosted/API**
backend. Loops are written once and run on either provider. Looper makes no direct
model API calls on the primary path.

## Guiding Decisions

- Primary execution is the **provider's cloud agent on the user's subscription**,
  dispatched through the provider's subscription-native surface (Codex:
  `@codex` mention/assignment only — no cloud REST API; Claude: imported routine
  API `/fire` URL + bearer token. Claude-native schedule/GitHub event triggers
  exist but are configured in Claude and are not Looper's primary dispatch path).
- The backend interface is `dispatch(brief) → ingest(PR/result)`. The controller
  composes the brief and gates the result; the provider sandbox runs the work.
- Backends are config-selected and may differ per loop (implement on one, review
  on another — e.g. `@codex review` on a Claude-authored PR).
- A **self-hosted/API backend** is a confirmed secondary option (not the
  default): the adopter self-hosts the execution container and uses their own API
  key, recovering full secret/network access and ZDR support for the three cases
  the subscription path can't serve (ZDR orgs, no subscription, tests needing live
  secrets/network).
- Prompts/briefs/policies are versioned, reviewable repo artifacts, not inline
  strings.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0019 | planned | task/0019-execution-backend-interface | Execution Backend Interface | The `dispatch(brief) → ingest(result)` contract + capability metadata. |
| 0020 | planned | task/0020-claude-subscription-backend | Claude Subscription Backend | Dispatch via imported Claude routine `/fire` URL/token + cloud sessions. |
| 0021 | planned | task/0021-codex-subscription-backend | Codex Subscription Backend | Dispatch via GitHub `@codex` mention/assignment; ingest its PRs. |
| 0073 | planned | task/0073-dispatch-and-result-ingestion | Dispatch & Result Ingestion (correlation) | Translate provider-agent output (PRs, comments) into GitHub state + plan updates. |
| 0074 | planned | task/0074-self-hosted-api-backend | Self-Hosted / API Backend (secondary) | Adopter self-hosts the execution container + brings own API key; recovers full secret/network access, no rate caps, ZDR support. |
| 0022 | planned | task/0022-prompt-and-policy-artifacts | Prompt & Policy Artifacts | Versioned, overridable brief/prompt/policy files per loop + backend. |
| 0023 | planned | task/0023-backend-selection-and-subscription-auth | Backend Selection & Subscription Auth | Per-loop backend choice + subscription auth (Claude routine import; provider App where applicable). |

## Definition Of Done

- A documented execution-backend interface exists with ≥2 conforming subscription
  backends (Claude, Codex) and the optional self-hosted backend.
- A loop can dispatch work to a provider cloud agent and ingest the resulting PR,
  with no direct model API call by looper on the primary path.
- Backends are selectable per loop and per stage (implement vs. review).
- Prompts/briefs live in the repo and can be overridden by adopters.
- Subscription auth (Claude imported `/fire` URL/token refs; provider App where
  applicable) is resolved without storing a long-lived model API key.

## Verification Log

Add dated entries as tasks land.
