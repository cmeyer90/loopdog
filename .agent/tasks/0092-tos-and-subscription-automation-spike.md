# 0092 ToS & Subscription-Automation Validation

Status: ready  
Branch: task/0092-tos-and-subscription-automation-spike

## Goal

Get an explicit, ideally written, answer to the question looper's whole premise
depends on: **may a third-party tool programmatically drive a user's paid Claude /
Codex subscription quota, unattended, at scale?** — before building the
subscription path.

## Background

Part of [Milestone 00](../milestones/milestone-00-pre-build-validation-spikes.md).
The architecture flags this as an open question ([architecture](../../docs/architecture.md)
"Verified provider capabilities"); the plan review ranked it the #1 blocker
because a "no" doesn't degrade looper — it removes its reason to exist (subscriptions
instead of API keys) and could get early adopters' accounts rate-limited or banned.

## Scope

- Read the actual Anthropic and OpenAI subscription + acceptable-use / API terms
  for clauses on automation, programmatic access, and personal-use restrictions —
  treat silence as provider-favorable, not as permission.
- Ask both providers' policy/devrel contacts the explicit question, in writing.
- Document the answer and a **consequence model**: if "no", what is looper's
  primary path (the self-hosted/API backend) and what changes.

## Out Of Scope

- Building anything; this is research + a decision.

## Acceptance Criteria

- [ ] A documented answer (with sources / contacts) for **both** providers on
      unattended third-party subscription orchestration.
- [ ] A written consequence model for a negative answer (self-hosted/API backend
      becomes primary; what that changes in M02/M05/M07 and the walkthroughs).
- [ ] A go/no-go recommendation on the subscription-primary thesis.

## Implementation Checklist

- [ ] Read both providers' subscription + AUP + API terms; extract relevant clauses.
- [ ] Contact provider policy/devrel; capture answers in writing.
- [ ] Write the consequence model + recommendation.

## Test Plan

```text
Non-code: terms reviewed + provider responses captured + decision recorded.
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the providers' answers, sources, and the go/no-go call.

## Risks / Rollback

The risk is building first and asking later — account bans + a product that can't
be responsibly recommended. This task exists to make that impossible.

## Final Summary

Fill this in before marking verified.
