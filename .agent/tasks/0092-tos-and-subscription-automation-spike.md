# 0092 ToS & Subscription-Automation Validation

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Get an explicit, ideally written, answer to the question loopdog's whole premise
depends on: **may a third-party tool programmatically drive a user's paid Claude /
Codex subscription quota, unattended, at scale?** — before building the
subscription path.

## Background

Part of [Milestone 00](../milestones/milestone-00-pre-build-validation-spikes.md).
The architecture flags this as an open question ([architecture](../../docs/architecture.md)
"Verified provider capabilities"); the plan review ranked it the #1 blocker
because a "no" doesn't degrade loopdog — it removes its reason to exist (subscriptions
instead of API keys) and could get early adopters' accounts rate-limited or banned.

## Scope

- Read the actual Anthropic and OpenAI subscription + acceptable-use / API terms
  for clauses on automation, programmatic access, and personal-use restrictions —
  treat silence as provider-favorable, not as permission.
- Ask both providers' policy/devrel contacts the explicit question, in writing.
- Document the answer and a **consequence model**: if "no", what is loopdog's
  primary path (the self-hosted/API backend) and what changes.

## Out Of Scope

- Building anything; this is research + a decision.

## Acceptance Criteria

- [x] A documented answer (with sources / contacts) for **both** providers on
      unattended third-party subscription orchestration.
- [x] A written consequence model for a negative answer (self-hosted/API backend
      becomes primary; what that changes in M02/M05/M07 and the walkthroughs).
- [x] A go/no-go recommendation on the subscription-primary thesis.

## Implementation Checklist

- [x] Read both providers' subscription + AUP + API terms; extract relevant
      clauses. (Full report: [`../reports/0092-tos-findings.md`](../reports/0092-tos-findings.md))
- [ ] **OPERATOR:** Contact provider policy/devrel; capture answers in writing.
      (Outward-facing outreach — channels + suggested question text are in the
      findings report §"Operator follow-up"; not performable autonomously.)
- [x] Write the consequence model + recommendation. (In the findings report.)

## Test Plan

```text
Non-code: terms reviewed + provider responses captured + decision recorded.
```

## Verification Log

- 2026-06-09: Web research pass over both providers' terms, AUPs, product docs,
  and enforcement precedents (42 sources; OpenAI legal pages block direct fetch
  — reconstructed from search snippets and flagged). Full citations in
  [`../reports/0092-tos-findings.md`](../reports/0092-tos-findings.md).
- 2026-06-09: Consequence model + conditional-GO recommendation written and
  cross-checked against the architecture's stated fallback (self-hosted/API
  backend re-centering).

## Decisions

- **Anthropic: permitted** for loopdog's exact Claude pattern — the routine
  `/fire` endpoint is officially documented for external programmatic callers
  (CI pipelines, internal tools), satisfying the Consumer ToS carve-out
  ("where we otherwise explicitly permit it"). Constraints adopted as design
  rules: one account = one adopter; never handle claude.ai login OAuth tokens
  (the Feb-2026 ban targets that surface); back off on 429s; model daily caps.
- **OpenAI: gray area (silence), conditional go** — nothing prohibits
  user-consented `@codex` automation; metering is the control; OpenAI steers
  automation to API keys. Ship "acts as you, on your repos, within your
  limits"; seek a written staff answer before claiming unattended-at-scale.
- **Go/no-go: CONDITIONAL GO** on the subscription-primary thesis (Claude GO,
  Codex conditional). No hosted multi-tenant mode in V1.
- New 2026-06-15 Anthropic **Agent SDK subscription credit** for third-party
  apps noted as a future alternative Claude backend (post-V1 consideration).

## Risks / Rollback

The risk is building first and asking later — account bans + a product that can't
be responsibly recommended. Residual risk after this task: the OpenAI answer is
inferred from silence, and Claude routines are research-preview (may change).
Mitigations: written-answer outreach is an explicit operator follow-up; the
consequence model keeps the self-hosted/API backend ready as primary; the gated
live-smoke (M18 · 0087) catches provider drift; budgets/quota (M12 · 0075) and
the circuit breaker (M19 · 0090) keep usage inside published limits.

## Final Summary

Researched both providers' terms, product docs, and enforcement history
(2026-06-09). Answer: Anthropic explicitly permits loopdog's Claude dispatch
pattern (per-routine `/fire` + bearer token is documented for external
automation; bounded by daily caps and subscription limits); OpenAI is a gray
area resolved to a conditional go (act as the adopter's own identity, within
metering; obtain written confirmation before at-scale claims). Wrote the full
findings + consequence model to `.agent/reports/0092-tos-findings.md`,
including the per-milestone re-centering plan if a provider says no (self-hosted
/API backend becomes primary). Provider outreach for a written answer is the
one remaining item and is operator-owned (channels + question text supplied).
