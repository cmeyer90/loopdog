# 0081 Trigger Source & Bot Controls (WHAT)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Decide **what** may drive a loop: per-loop allowed GitHub event sources and bot
actors. A loop honors only its configured trigger sources and reacts to bot
actors only when explicitly allowed — so a stray event kind or an unexpected bot
cannot cause an acting loop to spend.

## Background

Part of [Milestone 17](../milestones/milestone-17-authorization-and-trigger-control.md),
the **WHAT** leg of the WHO/WHAT/WHEN trio (WHO is 0079, WHEN/release is 0080,
rate/schedule is 0082). The runner (M03 · 0012) calls this in pre-flight, after
actor authorization (0079) and before the approval gate (0080), alongside
budget/quota/kill-switch (M12) and resilience policy (M19). Distinct from the
*transport* layer: event workflows (0008) and the sweep (0076) deliver events;
this task **filters** which delivered events a given loop is willing to act on.
Bots are special because the actor trust mapping (0079) keys on
`author_association`, which is ill-defined for bots — `[bot]` actors need their
own explicit allow/deny so `dependabot[bot]` can drive `dep-update` while an
unknown bot cannot. See [architecture](../../docs/architecture.md#authorization--trigger-control)
and "Triggering: events for latency, cron for resilience."

## Scope

- Per-loop **allowed event sources**: the subset of GitHub event kinds (and the
  cron source) a loop will act on; an event outside the set is acknowledged but
  not acted upon by that loop.
- Per-loop **bot allow/deny**: which `[bot]` actors may drive the loop; a bot not
  on the allow path is treated as untrusted (parked via 0080) or ignored.
- A pre-flight `TriggerSourceDecision` the runner consumes, ordered after 0079
  and feeding 0080's `on_unauthorized` handling.

### Technical detail

Lands in **`@loopdog/core`** (the decision logic + types, IO-free) with config
schema in **`@loopdog/config`**; the runner wires it in **`@loopdog/runtime`**
pre-flight (`runtime/src/pipeline`). Bot identity lookups (when needed) go
through `GitHubPort` in **`@loopdog/github`**.

The loop's `loop.yml` already declares its own `trigger:` (cron | github_event +
the event kind). This task adds an optional **authorization-scoped source filter**
so a loop can additionally constrain *which delivered events it acts on* and
*which bots may drive it*, independent of the natural `trigger:`:

```yaml
# .loopdog/loops/<name>/loop.yml  (authorization stanza, per-loop override of loopdog.yml)
authorization:
  trigger_sources:                 # selectors from 0008's event/action matrix
    - issue_comment.created
    - issues.labeled
    - pull_request.closed[merged]
  bots:
    allow: ["dependabot[bot]", "github-actions[bot]"]   # bot logins permitted to drive this loop
    deny:  ["*"]                   # default-deny other bots; explicit "*" deny documents intent
```

Trigger-source selectors are validated against 0008's canonical event/action
matrix and the synthetic `cron` source. Selector shape:

- `event.action` for actioned webhooks, e.g. `issues.opened`,
  `issue_comment.edited`, `pull_request.synchronize`,
  `pull_request_review.submitted`, `check_run.completed`,
  `workflow_run.completed`.
- `event.action[predicate]` for normalized predicates, currently
  `pull_request.closed[merged]` (the synthetic `merge` source).
- `status` for commit-status updates, whose state is in payload data rather than
  `action`.
- `label.created|edited|deleted` only for repository label-definition maintenance;
  item labels are `issues.labeled` / `pull_request.labeled`, never top-level
  `label`.
- `cron` for the reconcile sweep; it is always allowed as the backstop.

Decision shape (sibling to 0079's `{ trusted, actor, reason }`):

```ts
type TriggerSourceDecision = {
  source: TriggerSourceSelector | "cron";
  allowed: boolean;          // is this source permitted for this loop?
  isBot: boolean;
  botDisposition: "allowed" | "denied" | "n/a";
  reason: string;            // e.g. "event 'push' not in trigger_sources", "bot not in allow"
};
```

Resolution rules:

- **Source filter:** if `trigger_sources` is set, an event whose kind is not in
  the set yields `allowed: false`. Matching includes both event and action, plus
  predicates such as `pull_request.closed[merged]`; an unmerged
  `pull_request.closed` does not match the merge source. If omitted, default to the
  loop's own `trigger:` selector plus `cron` (the sweep must always be able to
  reconcile the loop). `cron` is never filterable out — the resilience backstop
  (0076) always runs.
- **Bot detection:** an actor is a bot when its login ends in `[bot]` or its
  GitHub type is `Bot`. For bots, **bypass the `author_association` mapping**
  (0079) and decide purely from `bots.allow`/`bots.deny`: `deny` wins; a glob
  `"*"` matches all bots; an actor matching neither list is denied (fail-closed).
  An allowed bot is treated as a **trusted** actor for the rest of pre-flight.
- **Strictest-wins** repo-default ∪ per-loop, consistent with 0079: a per-loop
  stanza may *narrow* the allowed sources/bots but not *widen* past the repo
  default unless the default is `anyone`/unset.
- **Disposition feeds 0080:** a denied source or denied bot is not a hard
  silent drop by default — it routes through `on_unauthorized` (park / ignore /
  comment) so a misconfigured bot surfaces as a parked item rather than vanishing.
  An out-of-`trigger_sources` event for the *wrong loop* is a plain no-op for that
  loop (other loops may still claim it).

Edge cases: the **provider's own agent** opening a PR (Anthropic's/OpenAI's App,
e.g. `claude[bot]` / `chatgpt-codex-connector[bot]`) is a bot event on the ingest
path — its login must be in the effective `bots.allow` (shipped default for the
built-in loops) or correlated ingestion (M05 · 0073) would be parked. The cron
"system" actor is trusted and exempt (per 0079). Re-labeling by the controller
acting as `GITHUB_TOKEN` is `github-actions[bot]`-shaped but only reaches a loop
via the sweep (0076), so its bot disposition must allow the system identity.

## Out Of Scope

- The actor trust decision for humans (0079); parking/release mechanics (0080);
  rate limits / schedule windows (0082).
- Event *delivery* / workflow wiring (0008) and the sweep (0076) — this filters,
  it does not transport.
- Backend-specific PR correlation (M05 · 0073), beyond ensuring provider bots are
  allowed by default.

## Acceptance Criteria

- [x] A loop with `trigger_sources` set acts only on those event kinds; an event
      of another kind/action/predicate is a no-op for that loop, and `cron` is
      never filtered out.
- [x] `trigger_sources` validates against 0008's canonical event/action matrix;
      `pull_request.closed[merged]`, item-label selectors, `status`, and
      `workflow_run.completed` have explicit tests.
- [x] A bot actor is detected (login `*[bot]` or type `Bot`) and decided from
      `bots.allow`/`bots.deny` only — `deny` wins, `"*"` matches all bots,
      unmatched bots are denied (fail-closed).
- [x] An allowed bot is treated as trusted for the rest of pre-flight; a denied
      bot/source routes through `on_unauthorized` (0080), not a silent spend.
- [x] Per-loop config narrows but cannot widen past the repo default (strictest
      wins), consistent with 0079.
- [x] The provider agent's bot login is allowed by the built-in loops' defaults so
      PR ingestion (0073) is not parked.
- [x] The runner consumes `TriggerSourceDecision` in pre-flight after 0079 and
      before 0080.

## Implementation Checklist

- [x] Add the `trigger_sources` + `bots.{allow,deny}` schema (root + per-loop) in
      `@loopdog/config` with zod validation against 0008's canonical event/action
      matrix.
- [x] Implement source-filter + bot-disposition logic in `@loopdog/core`
      (IO-free), returning `TriggerSourceDecision`.
- [x] Implement bot detection via login suffix / `GitHubPort` actor type.
- [x] Wire the decision into the runtime pre-flight order (after 0079, before 0080).
- [x] Ship provider-bot + `github-actions[bot]` allow defaults for built-in loops.
- [x] Apply strictest-wins repo ∪ per-loop resolution (shared with 0079).

## Test Plan

Tests run via the repo's `vitest` runner; behavioral cases use the M18 fakes
(in-memory GitHub from 0083), no real quota.

```bash
# replace with the chosen stack's vitest invocation
# table-test: event/action selectors × trigger_sources → allowed/no-op; cron always allowed
# item labels: issues.labeled/pull_request.labeled match; top-level label.created does not
# merge: pull_request.closed[merged] matches only when merged=true
# bot detection: [bot] login & type=Bot; deny-wins; "*" glob; unmatched → denied
# allowed bot → trusted; denied source/bot → routed to on_unauthorized (0080)
# provider bot login passes the built-in defaults (ingest not parked)
```

## Verification Log

- 2026-06-09: authorization suite green (196 tests repo-wide): pure WHO/WHAT/
  WHEN gates (association floors, deny-wins, allow-override, allowlist, cron-
  trusted, strictest-wins merge; trigger-source + bot allow/deny; rate +
  schedule windows) and the e2e controller flow (untrusted → parked
  needs-approval with zero dispatch; untrusted self-approval revoked; trusted
  collaborator approval releases + dispatches; trusted trigger dispatches
  immediately).

## Decisions

- Per-loop `authorization.trigger_sources` (event selectors, validated
  against the 0008 matrix incl. `pull_request.closed[merged]`) constrains
  which delivered events a loop acts on beyond its natural trigger;
  `authorization.bots.{allow,deny}` gates `[bot]` actors (bots need explicit
  allow because `author_association` is ill-defined for them). `triggerSourceAllowed`
  is pure; an off-source or unallowed-bot trigger feeds 0080's on_unauthorized
  park (or ignore).

## Risks / Rollback

A too-permissive bot allowlist (e.g. accidental `"*"`) re-opens the quota-drain
vector this milestone closes — default-deny bots and require explicit logins.
Conversely, forgetting the provider's own bot in the defaults would park every
legitimately ingested PR (0073); the built-in-loop defaults must include it and a
scenario test must prove ingestion is not parked. Rollback: an empty
`trigger_sources` + permissive `bots` reduces to the bare 0008 behavior (no
source filtering), so the feature is additive and safe to disable per loop.

## Final Summary

`triggerSourceAllowed` filters which events a loop acts on and which bots may
drive it — the WHAT control, composed after actor trust and feeding the
approval gate; `dependabot[bot]` can drive dep-update while unknown bots can't.
