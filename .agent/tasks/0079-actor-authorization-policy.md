# 0079 Actor Authorization Policy (WHO)

Status: verified  
Branch: claude/laughing-johnson-8a7944

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

- [x] Each trigger yields a `{ trusted, actor, reason }` decision against the
      resolved policy.
- [x] `actors` levels (anyone/org-members/collaborators/allowlist) + `allow`/`deny`
      behave as specified; `deny` always wins; cron is trusted.
- [x] Per-loop policy can tighten the repo default; strictest applicable wins.
- [x] Team allowlist entries resolve via the API and are cached.

## Implementation Checklist

- [x] Map `author_association` + allow/deny to a trust decision.
- [x] Implement repo-default ∪ per-loop strictest-wins resolution.
- [x] Resolve + cache team membership.
- [x] Expose the decision to the pre-flight gate (0080 / M03 · 0012).

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# table-test associations × policies; deny-wins; cron trusted; team allowlist
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

- `resolveActorTrust` maps `author_association` to a policy floor
  (anyone=NONE, org-members=MEMBER, collaborators=COLLABORATOR,
  allowlist=allow-only); deny always wins (an explicit allow overrides a `*`
  deny); cron is the trusted system actor. `resolveAuthorizationPolicy` merges
  repo-default with per-loop, taking the STRICTER actors level and the UNION
  of allow/deny — a loop tightens, never loosens.
- Team-allowlist (`@org/team`) membership resolution is deferred: V1 matches
  literal logins + `[bot]` actors; team expansion needs a GitHub API lookup
  the gate can add without shape change (recorded scope note).

## Risks / Rollback

A too-loose default exposes the maintainer's quota; default to `collaborators` and
fail closed (treat unknown association as untrusted).

## Final Summary

Pure actor-trust resolution in core: association floors + allow/deny with
deny-wins and allow-override, cron trusted, strictest-wins repo/loop merge —
the WHO decision the pre-flight gate consumes.
