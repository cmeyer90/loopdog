# 0034 Event-Driven Clarification

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

When a human replies to a loopdog clarification question on an issue, re-enter
grooming **on that `issue_comment` event** — never by polling "did they answer
yet." Recognize the reply as an answer (not noise), fold it back into the issue's
grooming context, and hand the item back to the grooming work cell (0033) to
re-groom and re-post the plan-as-contract.

## Background

Part of [Milestone 08](../milestones/milestone-08-grooming-and-clarification-loop.md):
the clarification half of the first loop. The milestone's guiding decision is
explicit — *"Clarification is event/webhook-triggered, never polled for 'did the
human reply yet.'"* See [architecture](../../docs/architecture.md) "Triggering:
events for latency, cron for resilience" and "The loops" (grooming). This task is
the consumer side of the `issue_comment` event already wired by the event trigger
(0008); the grooming work cell (0033) posts the question and does the re-grooming,
the assume-vs-block policy (0035) decides *when* a question is asked at all, and
the loop runtime (0036) wires this transition into an executable loop. It lands as
a **built-in loop asset** plus the deterministic logic in `@loopdog/runtime`/
`@loopdog/github` that classifies the reply and re-enters grooming.

## Scope

- A clarification re-entry transition: `needs-clarification → needs-grooming`,
  triggered by an `issue_comment` event on an issue currently in
  `loopdog:state/needs-clarification`.
- A **maintainer-vs-noise classifier**: decide whether a given comment is a
  genuine reply to loopdog's outstanding question (re-enter grooming) or noise
  (ignore, no spend).
- Threading the human's answer into the grooming brief so the re-groom sees the
  question *and* its answer.
- Idempotency: the same comment delivered twice (event + sweep, or duplicate
  webhook) re-enters grooming at most once.

### Technical detail

**Where it lands.** The classifier + re-entry logic is deterministic controller
code in `@loopdog/runtime` (pipeline step for the clarification transition), reading
GitHub state via `@loopdog/github` (comment author, `author_association`, body,
issue labels, the question marker). The loop itself is a built-in asset:
`templates/loops/groom-clarify/{loop.yml,prompt.md}` shipped from
`runtime/src/loops-builtin/`. No new package.

**The clarification marker (the contract this task keys off).** When grooming
(0033) asks a question instead of proceeding (0035), it sets the issue to
`loopdog:state/needs-clarification` and posts a comment carrying a fenced marker so
the answer can be correlated back deterministically — mirroring the
acceptance-criteria marker scheme (M03 · 0014):

```
<!-- loopdog:clarify run=run_91c loop=groom -->
**Loopdog needs one decision to proceed:** …question…
<!-- /loopdog:clarify -->
```

The marker records the originating `run_id`/`loop` so a reply ties to the exact
question (defense in depth: marker + the item's `needs-clarification` label + the
reply being *after* the question comment).

**Loop definition** (`templates/loops/groom-clarify/loop.yml`):

```yaml
name: groom-clarify
trigger: { github_event: issue_comment }     # created/edited on an issue
transition: { from: needs-clarification, to: needs-grooming }
backend: claude
gates: { require_dor: false, tier: safe }     # comment-only re-entry; no code
```

**Maintainer-vs-noise classifier** (deterministic; runs in pre-flight before any
claim). A comment re-enters grooming **iff all** hold:

1. **State**: the issue currently carries `loopdog:state/needs-clarification` AND an
   un-answered `loopdog:clarify` question comment exists above this reply.
2. **Not self/bot echo**: the comment author is not loopdog's own identity
   (`GITHUB_TOKEN`/`github-actions[bot]`) nor the provider agent — those never
   re-trigger and must never count as an answer (avoids self-reply loops).
3. **Authorized actor** (M17 · 0079): the author passes the loop's actor policy
   (default `collaborators`). An untrusted reply is **parked**
   (`loopdog:needs-approval`), not acted on — reusing the authorization gate, not a
   new path.
4. **Substantive, not a directive**: the body is not solely a loopdog/bot command
   (`@loopdog approve`, `/fire`, an emoji-only/`+1` reaction-style comment). Pure
   directives route to their own handlers, not grooming.

If 1–4 hold → the comment is a maintainer answer; else it is **noise** → return
`null` (no transition, no run record beyond a skipped-trigger trace, zero spend).
Edits to a prior answer (`issue_comment edited`) are treated as a fresh answer
to the same question (re-groom with the latest text).

**Re-entry behavior.** On a positive classification the pipeline:

1. Claims the item (M03 · 0013) under the clarification transition key
   `(groom-clarify, issue, needs-clarification)` — atomic; races with the sweep
   (0076) are safe.
2. Composes the re-groom brief: the original issue context + the
   `loopdog:clarify` question + **the human's answer text** (and any later answers
   in the same thread), so the work cell re-grooms *with* the resolution rather
   than re-asking. The brief is built by the grooming work cell (0033); this task
   supplies the threaded Q&A as composition input.
3. Sets the label to `loopdog:state/needs-grooming`. Re-grooming then proceeds via
   0033 (which may resolve, ask a *follow-up* question, or, per 0035, assume-and-
   proceed) — looping back through this transition for any further replies.

**Idempotency.** Guard on the answering comment id recorded in the run record
(`steps[].detail.answer_comment_id`): re-entering grooming for a comment id already
processed is a no-op. This is what makes the event path and the sweep (0076)
safely redundant — the sweep re-checks `needs-clarification` items for unanswered
replies and carries any answer the webhook dropped, hitting the same guard.

**No polling.** There is no timer that asks GitHub "any reply yet?". The only
clock involved is the sweep's resilience pass (0076) and the stuck/stale timeout
(M19), both out of scope here — a `needs-clarification` item with no reply simply
waits for the human's event.

## Out Of Scope

- Posting the clarification question and doing the re-groom itself (0033).
- The rule for *whether* to ask vs. assume-and-proceed (0035).
- Action-trigger wiring + dry-run mode for the loop (0036) and the `issue_comment`
  workflow plumbing (M02 · 0008).
- A stale-clarification timeout / nudge (resilience policy, M19); the sweep
  internals (0076); the actor-policy resolution itself (M17 · 0079).

## Acceptance Criteria

- [x] An authorized human reply to an open `loopdog:clarify` question on a
      `needs-clarification` issue transitions it to `needs-grooming` **on the
      `issue_comment` event**, with no polling anywhere in the path.
- [x] The human's answer text is threaded into the re-groom composition input
      (question + answer both present).
- [x] Noise is ignored without spend: loopdog's/bot's own comments, comments on
      issues not in `needs-clarification`, pure directive/approval/emoji comments,
      and replies with no outstanding question all return `null` (no transition).
- [x] An untrusted actor's reply is parked (`needs-approval`), not acted on.
- [x] Re-entry is idempotent: the same comment delivered via event and sweep (or a
      duplicate webhook) re-enters grooming at most once.
- [x] An `issue_comment edited` on a prior answer re-grooms with the latest text.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Define the `loopdog:clarify` comment marker (shape + `run`/`loop` attrs) as a
      shared constant in `@loopdog/core`/`@loopdog/github`, consumed by 0033 too.
- [x] Implement the maintainer-vs-noise classifier (state + author + authz +
      substantive) returning answer | noise.
- [x] Implement the re-entry pipeline step: claim → thread Q&A into the brief →
      relabel to `needs-grooming`; record `answer_comment_id` in the run record.
- [x] Add the idempotency guard on `answer_comment_id`.
- [x] Ship `templates/loops/groom-clarify/{loop.yml,prompt.md}` and register it in
      `runtime/src/loops-builtin`.
- [x] Document the marker + reply protocol for adopters.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake/replay backend) — **no real quota, no live GitHub**.

```bash
# scenario (fake GitHub + fake backend):
#   open question → authorized human reply → transitions to needs-grooming, answer threaded
#   loopdog/bot self-comment, off-state issue, "+1", "@loopdog approve" → null (noise)
#   untrusted-actor reply → parked needs-approval
#   same comment via event + sweep → single re-entry (idempotent)
#   issue_comment edited → re-grooms with latest text
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- Clarification is a dedicated `clarify` builtin loop: trigger
  issue_comment.created (EVENT-driven — never polled), transition
  needs-clarification → ready-for-agent with a stay-fallback for follow-ups.
- The work cell receives the recent discussion (last 10 non-loopdog comments)
  in the brief context, so the human's answer is in-band.
- Stay-fallbacks (fallback == from) were made legal in config validation for
  exactly this loop shape.

## Risks / Rollback

- **Self-reply loop**: misclassifying loopdog's/the bot's own comment as an answer
  would spin grooming. Mitigated by the identity exclusion (#2) and the
  `GITHUB_TOKEN` no-self-retrigger rule — both must hold before `act` mode.
- **Quota drain on a busy issue**: every comment on a `needs-clarification` issue
  hits the classifier; keep it deterministic and pre-claim so noise costs zero
  spend. Rollback: run the loop in dry-run (0036) — classify and log, never
  relabel — until the predicate is trusted on a real repo.

## Final Summary

A human reply re-grooms the issue through the clarify loop with the
discussion in the brief; resolved → ready-for-agent, new ambiguity → one
follow-up question and stay. Event-triggered, proven in the e2e clarification
scenario.
