# 0080 Approval Gate & Parked Items (WHEN / release)

Status: planned  
Branch: task/0080-approval-gate-and-parked-items

## Goal

When a trigger isn't authorized (0079), **acknowledge but park** the item for a
trusted human's approval instead of spending — and provide the release path
(`looper:approved` label / `looper approve`), audited.

## Background

Part of [Milestone 17](../milestones/milestone-17-authorization-and-trigger-control.md).
This is the safe-by-default behavior that stops untrusted triggers from draining
the subscription or reaching an acting work cell. See
[architecture](../../docs/architecture.md#authorization--trigger-control).

## Scope

- Implement `on_unauthorized` behavior: `park` (default) | `ignore` | `comment`.
- The `looper:needs-approval` hold marker + the gate that blocks dispatch while held.
- The release path: a trusted human applies `approval_label` or runs
  `looper approve <item>`; the item resumes its intended transition.
- Audit every park/approve/deny (who/when/what) in the run record + a comment.

### Technical detail

- `looper:needs-approval` is an **operational hold label** (not a lifecycle state):
  the item stays in its natural state but the pre-flight gate refuses to claim/
  dispatch while the hold is present and `approval_label` is absent.
- On an untrusted trigger (per 0079) with `on_unauthorized: park`: add the hold,
  post a short comment ("held for maintainer approval — a collaborator can apply
  `looper:approved` or run `looper approve`"), and **do not dispatch**.
- **Release authorization:** applying `approval_label` only counts when done by a
  *trusted* actor (re-check via 0079 on the item-label event:
  `issues.labeled` or `pull_request.labeled`) — otherwise an untrusted user could
  self-approve. `looper approve <item>` (CLI) does the same, authed via the
  operator's identity.
- On release: remove the hold, record the approver, and let the item proceed on the
  next event/sweep.
- `ignore` drops silently (private/trusted repos); `comment` explains without
  holding (advisory mode).

## Out Of Scope

- The actor trust decision itself (0079); rate/schedule limits (0082).

## Acceptance Criteria

- [ ] An unauthorized trigger with `park` adds `looper:needs-approval`, comments,
      and dispatches nothing.
- [ ] Applying `approval_label` **by a trusted actor** (or `looper approve`) releases
      the item; an untrusted self-approval does **not** release it.
- [ ] `ignore` and `comment` modes behave as specified.
- [ ] Every park/approve/deny is recorded (approver + timestamp) and surfaced to the
      CLI (`looper status` shows parked items).

## Implementation Checklist

- [ ] Implement the hold marker + the pre-flight block while held.
- [ ] Implement `on_unauthorized` modes (park/ignore/comment).
- [ ] Implement trusted-only release via label + `looper approve` CLI.
- [ ] Audit + surface parked items in the CLI.

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# untrusted trigger → parked, no dispatch; trusted approval → releases;
# untrusted self-approval → still parked
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record hold-label-vs-state choice, the self-approval defense, and the audit shape.

## Risks / Rollback

The self-approval bypass is the key risk — re-authorize the approver on the
`issues.labeled` / `pull_request.labeled` event, never trust the label's mere
presence.

## Final Summary

Fill this in before marking verified.
