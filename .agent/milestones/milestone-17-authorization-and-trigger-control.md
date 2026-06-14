# Milestone 17: Authorization & Trigger Control

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) "Authorization &
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
  acting loops; an untrusted trigger gets a `loopdog:needs-approval` hold and is
  acknowledged but unspent until a trusted human releases it (`loopdog:approved` /
  `loopdog approve`). Parking untrusted content before it reaches an acting work
  cell also shrinks the injection surface.
- Configurable repo-wide and per-loop; the **strictest** applicable rule wins.
  Cheap loops (grooming) may be permissive; spendy ones (implement/deploy) strict.
- Releasing (approval) is itself an authorized action and is audited (who/when).
- This milestone owns **intentional/abuse** controls (untrusted actors, per-actor
  rate caps, schedule windows). System-load/failure controls live in M19.

Config (repo default in `loopdog.yml`, overridable per loop):

```yaml
authorization:
  actors: collaborators        # anyone | org-members | collaborators | allowlist
  allow: ["@dana", "@team/maintainers", "dependabot[bot]"]
  deny: []
  on_unauthorized: park        # park (needs-approval) | ignore | comment
  approval_label: "loopdog:approved"
  rate_limit: { per_actor_per_day: 5, global_per_hour: 20 }
  schedule_window: { days: [mon-fri], hours: "09-18", tz: "America/Los_Angeles" }
```

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0079 | verified | task/0079-actor-authorization-policy | Actor Authorization Policy (WHO) | author-association / collaborators / org / allow+deny resolution; repo-default + per-loop, strictest-wins. |
| 0080 | verified | task/0080-approval-gate-and-parked-items | Approval Gate & Parked Items (WHEN / release) | `loopdog:needs-approval` hold + `on_unauthorized` behavior + `loopdog:approved`/`loopdog approve` release, audited. |
| 0081 | verified | task/0081-trigger-source-and-bot-controls | Trigger Source & Bot Controls (WHAT) | Per-loop allowed events/bots; deny/allow bot actors; honor only configured trigger sources. |
| 0082 | verified | task/0082-rate-limits-and-schedule-windows | Rate Limits & Schedule Windows (WHEN) | Per-actor + global trigger rate caps; optional schedule windows; coordinate with budget (M12). |

## Definition Of Done

- [x] A documented `authorization:` policy (root + per-loop) is enforced as a
  pre-flight gate; strictest applicable wins (resolveAuthorizationPolicy).
- [x] An untrusted-actor trigger on a public repo NEVER dispatches/spends; it
  is parked (needs-approval) until a trusted human releases it (e2e-proven).
- [x] Per-actor + global rate limits and optional schedule windows are honored
  (defer, never spend); bot/event sources are allow/deny-able per loop.
- [x] Approvals/denials are audited (run records + hold/release comments) and
  visible from the CLI (`loopdog status`, `loopdog approve`).

## Verification Log

- 2026-06-09: M17 verified; 196 tests green repo-wide. WHO/WHAT/WHEN are pure
  core gates composed into the runtime pre-flight ahead of budget/quota;
  parking reuses the operational-hold machinery; trusted-only release is
  enforced at the approval-label event. `loopdog approve` added to the CLI.
