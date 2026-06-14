# 0080 Approval Gate & Parked Items (WHEN / release)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

When a trigger isn't authorized (0079), **acknowledge but park** the item for a
trusted human's approval instead of spending — and provide the release path
(`loopdog:approved` label / `loopdog approve`), audited.

## Background

Part of [Milestone 17](../milestones/milestone-17-authorization-and-trigger-control.md).
This is the safe-by-default behavior that stops untrusted triggers from draining
the subscription or reaching an acting work cell. See
[architecture](../../docs/architecture.md#authorization--trigger-control).

## Scope

- Implement `on_unauthorized` behavior: `park` (default) | `ignore` | `comment`.
- The `loopdog:needs-approval` hold marker + the gate that blocks dispatch while held.
- The release path: a trusted human applies `approval_label` or runs
  `loopdog approve <item>`; the item resumes its intended transition.
- Audit every park/approve/deny (who/when/what) in the run record + a comment.

### Technical detail

- `loopdog:needs-approval` is an **operational hold label** (not a lifecycle state):
  the item stays in its natural state but the pre-flight gate refuses to claim/
  dispatch while the hold is present and `approval_label` is absent.
- On an untrusted trigger (per 0079) with `on_unauthorized: park`: add the hold,
  post a short comment ("held for maintainer approval — a collaborator can apply
  `loopdog:approved` or run `loopdog approve`"), and **do not dispatch**.
- **Release authorization:** applying `approval_label` only counts when done by a
  *trusted* actor (re-check via 0079 on the item-label event:
  `issues.labeled` or `pull_request.labeled`) — otherwise an untrusted user could
  self-approve. `loopdog approve <item>` (CLI) does the same, authed via the
  operator's identity.
- On release: remove the hold, record the approver, and let the item proceed on the
  next event/sweep.
- `ignore` drops silently (private/trusted repos); `comment` explains without
  holding (advisory mode).

## Out Of Scope

- The actor trust decision itself (0079); rate/schedule limits (0082).

## Acceptance Criteria

- [x] An unauthorized trigger with `park` adds `loopdog:needs-approval`, comments,
      and dispatches nothing.
- [x] Applying `approval_label` **by a trusted actor** (or `loopdog approve`) releases
      the item; an untrusted self-approval does **not** release it.
- [x] `ignore` and `comment` modes behave as specified.
- [x] Every park/approve/deny is recorded (approver + timestamp) and surfaced to the
      CLI (`loopdog status` shows parked items).

## Implementation Checklist

- [x] Implement the hold marker + the pre-flight block while held.
- [x] Implement `on_unauthorized` modes (park/ignore/comment).
- [x] Implement trusted-only release via label + `loopdog approve` CLI.
- [x] Audit + surface parked items in the CLI.

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# untrusted trigger → parked, no dispatch; trusted approval → releases;
# untrusted self-approval → still parked
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

- `loopdog:needs-approval` is an operational hold (the park verdict's
  holdLabel); the runner's standardChecks treat it as blocking UNLESS
  `loopdog:approved` is also present. `on_unauthorized`: park (default, holds
  + comments), ignore (skip silently), comment (advisory). 
- Trusted-only release: the controller intercepts `issues.labeled`/
  `pull_request.labeled` adding the approval label and, if the labeler is
  untrusted (0079), STRIPS it + comments — so an untrusted self-approval can't
  release. `loopdog approve <item>` (CLI) applies the label as the operator's
  (trusted) identity. The approval-label event itself re-runs the loops, so
  release and dispatch happen in one step.
- Audit: park/approve are recorded as run records (status: parked) + sticky
  `loopdog:hold` marker comments + the release comment; `loopdog status` lists
  off-ramp/hold items.

## Risks / Rollback

The self-approval bypass is the key risk — re-authorize the approver on the
`issues.labeled` / `pull_request.labeled` event, never trust the label's mere
presence.

## Final Summary

Untrusted triggers park (needs-approval) with no spend; only a trusted
human's `loopdog:approved` (or `loopdog approve`) releases them — untrusted
self-approval is revoked. Every park/release is audited and CLI-visible.
