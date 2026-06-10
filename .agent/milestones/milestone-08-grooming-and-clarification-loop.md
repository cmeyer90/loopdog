# Milestone 08: Grooming & Clarification Loop

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "The loops"
> (grooming). The first, lowest-blast-radius loop; proves the platform end to end.

## Objective

Ship the first loop: transform raw issues to Definition-of-Ready, create the
durable plan, post a plan-as-contract, and handle clarification via events — biased
toward stating assumptions and proceeding rather than blocking.

## Guiding Decisions

- Lowest blast radius (edits only issue text + plans, never code), so it proves
  triggering, claiming, provider calls, and plan binding safely.
- Clarification is event/webhook-triggered, never polled for "did the human reply
  yet."
- Bias to assume-and-proceed; hard-block only on genuinely ambiguous or
  destructive choices.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0033 | planned | task/0033-grooming-work-cell | Grooming Work Cell | Rewrites an issue to DoR and emits the plan + plan contract. |
| 0034 | planned | task/0034-event-driven-clarification | Event-Driven Clarification | Webhook-triggered responder to issue-comment events. |
| 0035 | planned | task/0035-assumption-vs-block-policy | Assumption-vs-Block Policy | Deterministic rule for assume-and-proceed vs. `needs-clarification`. |
| 0036 | planned | task/0036-grooming-loop-runtime | Grooming Loop Runtime | Action trigger wiring + dry-run (comment-only) mode. |

## Definition Of Done

- A raw issue is groomed to DoR (acceptance criteria + scope bounds + test plan)
  with a linked plan, and acceptance criteria are expressed as **executable
  acceptance tests wherever possible** so satisfaction can be validated
  objectively later (rung 2), not only by reviewer judgment.
- A plan-as-contract is posted before any downstream work.
- Comment replies are handled on events, not polling.
- The loop runs in dry-run before it is trusted to relabel.

## Verification Log

Add dated entries as tasks land.
