# Milestone 17: Authorization & Trigger Control

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) "Authorization &
> trigger control." Closes a production gap: on a public repo, anyone can open an
> issue/comment — and under the bare design that could drive acting loops on the
> maintainer's subscription (quota drain + injection vector). Depends on M03
> (runner + state machine) and M02 (config).

## Objective

Give maintainers explicit control over **who** may trigger acting loops, **what**
may drive them, and **when** they run — enforced as a pre-flight gate before any
claim/dispatch, **safe-by-default**: untrusted triggers are acknowledged but
*parked for human approval*, never silently spent.

## Guiding Decisions

- Authorization is a **pre-flight gate** in the transition runner (M03 · 0012),
  evaluated *before* claim/dispatch — the access-control sibling of budget/quota/
  kill-switch.
- **Safe by default:** on public repos only trusted actors (collaborators+) drive
  acting loops; an untrusted trigger gets a `looper:needs-approval` hold and is
  acknowledged but unspent until a trusted human releases it (`looper:approved` /
  `looper approve`). Parking untrusted content before it reaches an acting work
  cell also shrinks the injection surface.
- Configurable repo-wide and per-loop; the **strictest** applicable rule wins.
  Cheap loops (grooming) may be permissive; spendy ones (implement/deploy) strict.
- Releasing (approval) is itself an authorized action and is audited (who/when).
- This milestone owns **intentional/abuse** controls (untrusted actors, per-actor
  rate caps, schedule windows). System-load/failure controls live in M19.

Config (repo default in `looper.yml`, overridable per loop):

```yaml
authorization:
  actors: collaborators        # anyone | org-members | collaborators | allowlist
  allow: ["@dana", "@team/maintainers", "dependabot[bot]"]
  deny: []
  on_unauthorized: park        # park (needs-approval) | ignore | comment
  approval_label: "looper:approved"
  rate_limit: { per_actor_per_day: 5, global_per_hour: 20 }
  schedule_window: { days: [mon-fri], hours: "09-18", tz: "America/Los_Angeles" }
```

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0079 | planned | task/0079-actor-authorization-policy | Actor Authorization Policy (WHO) | author-association / collaborators / org / allow+deny resolution; repo-default + per-loop, strictest-wins. |
| 0080 | planned | task/0080-approval-gate-and-parked-items | Approval Gate & Parked Items (WHEN / release) | `looper:needs-approval` hold + `on_unauthorized` behavior + `looper:approved`/`looper approve` release, audited. |
| 0081 | planned | task/0081-trigger-source-and-bot-controls | Trigger Source & Bot Controls (WHAT) | Per-loop allowed events/bots; deny/allow bot actors; honor only configured trigger sources. |
| 0082 | planned | task/0082-rate-limits-and-schedule-windows | Rate Limits & Schedule Windows (WHEN) | Per-actor + global trigger rate caps; optional schedule windows; coordinate with budget (M12). |

## Definition Of Done

- A documented `authorization:` policy (root + per-loop) is enforced as a pre-flight
  gate; the strictest applicable rule wins.
- An untrusted-actor trigger on a public repo **never dispatches/spends**; it is
  parked (`needs-approval`) until a trusted human releases it.
- Per-actor and global trigger rate limits and optional schedule windows are
  honored; bot/event sources are allow/deny-able per loop.
- Approvals and denials are audited (who/when/what), visible from the CLI.

## Verification Log

Add dated entries as tasks land.
