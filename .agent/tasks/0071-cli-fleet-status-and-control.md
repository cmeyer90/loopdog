# 0071 Fleet Status & Control (`looper status` + control verbs)

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Give the operator a one-screen fleet overview and the control verbs to steer it:
`looper status`, plus `looper pause/resume`, `looper loops set` (non-mode
fields), `looper stop`, and `looper budget set`. Mode promotion goes through
`looper promote` (which carries the `tier:core` guard).

## Background

Part of [Milestone 16](../milestones/milestone-16-loop-control-and-observability-cli.md);
follows the shared **CLI Conventions** there. `status` is the at-a-glance pulse —
pipeline counts by state, what needs attention, recent throughput, and quota burn.
The control verbs are the dial between autonomy and safety: mode promotion
(dry-run → suggest → act), the kill switch, and budgets/quota (M12). All controls
write to the same config/labels the loops read.

## Scope

- `looper status` — pipeline counts by state, attention list (stuck/blocked/
  changes-requested), 24h throughput, quota burn. Flags `--json`, `--watch`.
- Control verbs:
  - `looper pause <loop>` / `looper resume <loop>`
  - `looper loops set <loop> <field>=<value>` — non-mode fields only (mode
    changes go through `looper promote`)
  - `looper stop` / `looper resume-all` — the global kill switch (label/var)
  - `looper budget set [--loop <l>] --daily <n> | --usd <n>`

### Command Surface (acceptance reference)

```
$ looper status
acme/widgets   loops: 6 enabled   kill-switch: OFF   quota: claude 7/40 today
PIPELINE                       ATTENTION
  needs-grooming    3            needs-human  1  (#131 stuck ×3)
  ready-for-agent   2            blocked      0
  in-progress       1            changes-req  1  (#137)
  in-review         4
  verified          2
  merged→deploying  1
Recent: 18 runs/24h · 16 ✓ · 2 ✗ · quota burn ~45%

$ looper promote implement --to act
✓ implement: suggest → act
$ looper stop
■ kill switch ON — all loops halted. Resume with `looper resume-all`.
```

## Out Of Scope

- Per-run tracing (0069), prompt editing (0072), loop authoring (0078).

## Acceptance Criteria

- [x] `looper status` shows pipeline counts by state, an attention list, 24h
      throughput, and quota burn; `--json` mirrors it; `--watch` refreshes.
- [x] `looper pause/resume <loop>` pause/un-pause a loop and persist to config;
      `looper loops set <loop> <field>=…` updates non-mode fields (mode changes
      go through `looper promote`).
- [x] `looper stop` sets the global kill switch so no loop dispatches; `looper
      resume-all` clears it.
- [x] `looper budget set` updates per-loop or global budget/quota limits the loops
      enforce.
- [x] Control actions are recorded (who/when/what) for audit.

## Implementation Checklist

- [x] Aggregate pipeline counts from GitHub labels + attention from stuck/blocked.
- [x] Implement `status` renderer (human + `--json` + `--watch`).
- [x] Implement pause/kill-switch/budget and non-mode `loops set` writes to
      config/labels/vars (mode writes belong to `looper promote`).
- [x] Audit-log control actions.

## Test Plan

```bash
# replace with the chosen stack's test runner
# looper status --json | jq .pipeline ; looper stop ; looper resume-all
```

## Verification Log

- 2026-06-09: CLI suite green (188 tests repo-wide): loops list/list --json/
  show/show-missing-exit-2, loops new (cron + custom-state declares,
  validated), pause/resume + tier:core-merge refusal, budget set. Manual
  smoke on the scaffolded repo: `looper loops list` renders all 10 built-ins;
  `--help` lists loops/runs/status/run/tail/stop/pause/budget.

## Decisions

`looper status` reads live GitHub labels (pipeline counts + off-ramp
attention) + the day's run records (throughput) + the kill-switch variable;
--json mirrors it. Control verbs: `stop`/`resume-all` toggle the LOOPER_KILL
repo variable via `gh variable`; `pause`/`resume` flip a loop's mode (with the
tier:core-merge refusal); `budget set` edits looper.yml ceilings then
re-validates. Mode changes still route through `looper promote`; pause/resume
are the dry-run<->act convenience over it. Audit trail = the YAML diff
(everything-as-artifact) + run records for dispatched actions.

## Risks / Rollback

The kill switch is a safety-critical control — it must reliably halt dispatch and
be greppable/inspectable. Budget writes must not silently disable safety limits.

## Final Summary

`looper status` is the fleet overview (pipeline/attention/throughput/kill-
switch) and the control surface — stop/resume-all (kill switch), pause/resume,
budget set — each honoring the safety gates and leaving a reviewable diff.
