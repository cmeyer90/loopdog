# Walkthrough: A ticket's lifecycle (Claude subscription)

One issue, end to end: filed → groomed → implemented → reviewed → merged →
deployed — driven by Dana's Claude subscription. Labels are the state machine;
looper's controller dispatches each step to a Claude cloud agent and gates the
result.

Assumes Dana has [connected her accounts](connecting-accounts.md) and attached
looper (loops in `dry-run`/`suggest` until promoted).

## 0. The ticket

Dana files a sparse issue **#142 "Add rate limiting to the public API."** The
controller labels it `needs-grooming`.

## 1. Grooming (Milestone 08)

A cron/event fires the controller (in Dana's Actions — no model call). It checks
budget/quota/kill-switch, claims #142, composes a grooming brief, and **`/fire`s
the Claude grooming routine** with the issue as context. The Claude cloud session:

- rewrites #142 to **Definition-of-Ready** — explicit acceptance criteria, scope
  bounds (`src/api/**`), and a **test plan**:
  - [ ] per-API-key limiting at 100 req/min
  - [ ] returns HTTP 429 + `Retry-After` when exceeded
  - [ ] limit configurable via env
- creates the durable plan `.looper/plans/tasks/0001-api-rate-limiting.md` bound
  to #142, and posts a **plan-as-contract** comment.

It hits one ambiguity and, per the assume-or-block policy, states an assumption
and proceeds (hard-blocking only on destructive/ambiguous choices). Label →
`ready-for-agent`; the issue label mirrors the plan's `Status`.

## 2. Implementation (Milestone 09)

The controller atomically **claims** #142 (assign-bot + `in-progress`, serialized
so nothing else touches `src/api/**` concurrently), composes an implementation
brief from the plan, and **`/fire`s the imported Claude implementation routine**.
In Anthropic's sandbox, the setup script and env vars Dana configured in the
Claude cloud environment are present, so the Claude instance **implements rate
limiting, writes a test per acceptance criterion, runs `npm test`, and opens PR
#143** referencing #142 with the plan contract.

Guardrail: the change stays under `max_diff`; a 40-file refactor would
**halt and escalate** instead. Looper **ingests** PR #143, updates the plan
(checklist, verification log), label → `in-review`.

## 3. Review, verification ladder & merge (Milestone 10)

1. **Rung 2 — Dana's own CI** runs on PR #143: the acceptance tests (`429 +
   Retry-After`, etc.) execute. This is the trustworthy gate looper **cannot
   edit**, authoritative regardless of where the work cell ran.
2. **Intent-diff** — a **cross-provider reviewer** (different model than the
   implementer) checks each acceptance criterion was delivered — not "does it
   compile." Unmet criteria → the fix-and-revalidate sub-loop.
3. **Definition-of-Done** — every criterion met + CI green + review approved.
   the merge loop's `mode: suggest`, so looper posts "ready to merge" and Dana clicks; once
   trusted she promotes `tier:safe` to auto-merge. Label → `merged`; plan
   `Status` → `merged`.

See [how satisfaction is validated](../architecture.md#how-we-know-the-request-was-satisfied).

## 4. Deploy & operational verification (Milestone 11)

Merge triggers deploy via the **project adapter** (auto-detected Node app).
Post-deploy **smoke/health checks** gate promotion; a failure triggers the
**auto-rollback loop**. Result is reported on #142 and the plan. Label →
`deployed`. The plan file is now a complete, durable record of the ticket.

## 5. Dana's role throughout

She mostly reads and tunes via the CLI:

```
$ looper status                     # pipeline + quota burn
$ looper runs show run_91c          # item, dispatched brief, steps, session+PR, cost
$ looper loops show implement       # config, the exact brief, the steps it drives
$ looper prompts edit implement     # tune how it's prompted
```

Safety nets she rarely thinks about: after K failures an item routes to
`needs-human` with backoff; the `looper:stop` label halts everything.

## In one line

> **Label change → controller `/fire`s the right Claude routine on Dana's
> subscription → the Claude cloud agent does the work and opens a PR → looper
> ingests and gates it against Dana's own CI → merge → deploy → the plan records
> it all.** Looper never makes a model API call and never asks for
> `ANTHROPIC_API_KEY`; project secrets live only where Dana configured them
> (Claude cloud environment or her own CI/self-hosted path).
