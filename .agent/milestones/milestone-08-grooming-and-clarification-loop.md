# Milestone 08: Grooming & Clarification Loop

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) — "The loops"
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
| 0033 | verified | task/0033-grooming-work-cell | Grooming Work Cell | Rewrites an issue to DoR and emits the plan + plan contract. |
| 0034 | verified | task/0034-event-driven-clarification | Event-Driven Clarification | Webhook-triggered responder to issue-comment events. |
| 0035 | verified | task/0035-assumption-vs-block-policy | Assumption-vs-Block Policy | Deterministic rule for assume-and-proceed vs. `needs-clarification`. |
| 0036 | verified | task/0036-grooming-loop-runtime | Grooming Loop Runtime | Action trigger wiring + dry-run (comment-only) mode. |

## Definition Of Done

- [x] A raw issue is groomed to DoR with a linked plan; the prompt mandates
  test-tagged criteria wherever possible (validated objectively at rung 2).
- [x] A plan-as-contract is posted before any downstream work (prompt mandate
  + the bound plan from plan-sync).
- [x] Comment replies are handled on events (the clarify loop's
  issue_comment.created trigger), never polled.
- [x] The loop ships dry-run by default (scaffold) and was proven comment-only
  in the 0009 mode tests before any act-mode run.

## Verification Log
- 2026-06-09: all tasks verified offline: the loops e2e suite drives the real
  scaffolded templates on fakes through the full lifecycle (169 tests green
  repo-wide). Live provider behavior remains the M00 operator item.
