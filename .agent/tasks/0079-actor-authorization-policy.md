# 0079 Actor Authorization Policy (WHO)

Status: planned  
Branch: task/0079-actor-authorization-policy

## Goal

Decide **who** may cause a loop to act: resolve a trigger's actor against a
configurable policy (author-association / collaborators / org / allow+deny),
repo-wide with per-loop overrides, strictest rule winning.

## Background

Part of [Milestone 17](../milestones/milestone-17-authorization-and-trigger-control.md).
The runner (M03 · 0012) calls this in pre-flight, before claim/dispatch. See
[architecture](../../docs/architecture.md#authorization--trigger-control).

## Scope

- Resolve the triggering actor (issue/PR/comment author, or the cron "system"
  actor) and classify their authorization for a given loop.
- Policy levels + allow/deny lists; repo-default + per-loop override; strictest
  applicable rule wins.
- Return an authorization decision the gate (0080) acts on.

### Technical detail

Actor trust uses GitHub's `author_association` (`OWNER`, `MEMBER`, `COLLABORATOR`,
`CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `NONE`) plus explicit allow/deny:

```
actors policy → minimum association required to be "trusted":
  anyone        → NONE
  org-members   → MEMBER
  collaborators → COLLABORATOR        (default)
  allowlist     → must be in `allow` (or an allowed team)
deny always wins; allow overrides the association floor (e.g. allow a bot).
```

- Decision: `{ trusted: bool, actor, reason }`. For cron triggers the actor is the
  configured "system" identity and is trusted by default (it can't come from an
  untrusted human).
- Resolution order: per-loop policy ∪ repo default → take the **strictest** (a
  loop can tighten but not loosen below the repo default unless explicitly set).
- Team membership (`@org/team`) resolved via the GitHub API and cached per run.

## Out Of Scope

- What happens to an untrusted trigger (parking/approval) — that is 0080.
- Rate limits / schedule windows (0082); bot/event source gating (0081).

## Acceptance Criteria

- [ ] Each trigger yields a `{ trusted, actor, reason }` decision against the
      resolved policy.
- [ ] `actors` levels (anyone/org-members/collaborators/allowlist) + `allow`/`deny`
      behave as specified; `deny` always wins; cron is trusted.
- [ ] Per-loop policy can tighten the repo default; strictest applicable wins.
- [ ] Team allowlist entries resolve via the API and are cached.

## Implementation Checklist

- [ ] Map `author_association` + allow/deny to a trust decision.
- [ ] Implement repo-default ∪ per-loop strictest-wins resolution.
- [ ] Resolve + cache team membership.
- [ ] Expose the decision to the pre-flight gate (0080 / M03 · 0012).

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# table-test associations × policies; deny-wins; cron trusted; team allowlist
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the trust mapping, the tighten-not-loosen rule, and team-resolution caching.

## Risks / Rollback

A too-loose default exposes the maintainer's quota; default to `collaborators` and
fail closed (treat unknown association as untrusted).

## Final Summary

Fill this in before marking verified.
