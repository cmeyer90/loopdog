# Milestone 16: Loop Control & Observability CLI

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) — "The operator
> interface: the CLI." Since the adopter's job is now *running the loops*, the CLI
> is loopdog's primary human surface. Reads the same three sources of truth as the
> rest of the system: GitHub state (live), the durable plan store (history), and
> run telemetry (aggregate, M12).

## Objective

Give operators a CLI to **manage and track loops**: see what loops exist, what
each one runs, **how it is prompted**, and **what its specific steps are**; inspect
run history (which item, the dispatched brief, the steps taken, the provider
session/PR, cost/quota, outcome); trigger and dry-run loops; tail live runs; and
tune prompts, modes, budgets, and the kill switch; and **author new loops**
(`loopdog loops new`) — all without a hosted UI. (The CLI also hosts `loopdog
login`, the keyless GitHub + provider connector from Milestone 02.)

## Guiding Decisions

- The CLI is read-mostly over existing sources of truth; it does not invent a new
  datastore. Live state = GitHub labels; history = plan store; aggregate = M12
  telemetry.
- "How it's prompted" is answerable: the CLI surfaces the exact versioned
  brief/prompt/policy artifact (M05 task 0022) a loop uses, and the composed brief
  for a specific run.
- "What its specific steps are" is answerable: the CLI shows the transition path a
  loop drives and the per-run step trace, with links into the provider session and
  the resulting PR.
- Control actions (trigger, dry-run, set mode/budget, kill switch) are explicit
  and respect the same safety gates as automated runs.
- Adding a loop is a guided, narrow action: because the trigger space is just
  **GitHub events + cron**, `loopdog loops new` runs a short **questionnaire**, then
  **generates a per-loop template folder** (`.loopdog/loops/<name>/` with `loop.yml`
  + `prompt.md`), **prints its path**, validates the transition (M03), and offers a
  dry-run. **Loops are data, not core code** — one file per loop, no monolithic
  config, no loopdog change needed.

## CLI Conventions (shared contract)

All M16 commands share one contract, so the task files don't repeat it:

- **Shape:** `loopdog <noun> <verb> [args] [flags]` — e.g. `loopdog loops show implement`.
- **Output:** human-readable tables/sections by default; `--json` emits stable
  machine output for *every* command; also `--no-color`, `-q/--quiet`, `-v/--verbose`.
- **Target:** `--repo <owner/name>`, defaulting to the repo in the cwd.
- **Data sources (no new datastore):** live state = GitHub labels/issues/PRs;
  history = the durable plan store (M04); aggregate = run telemetry (M12); prompts
  = the versioned brief artifacts (M05 · 0022).
- **Exit codes:** `0` ok · `1` usage error · `2` not-found · `3` auth needed.
- **Safety:** trigger/control actions honor budget, quota, and the kill switch
  exactly as automated runs do.
- **Degradation:** commands render from whatever sources exist; with telemetry
  absent they still show config/state and omit run stats.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0068 | verified | task/0068-cli-loop-introspection | Loop Introspection (`loopdog loops list` / `loopdog loops show`) | `loopdog loops list/show`: config, backend/provider, mode, prompt artifact, transition steps. |
| 0069 | verified | task/0069-cli-run-history-and-tracing | Run History & Tracing (`loopdog runs list` / `loopdog runs show`) | `loopdog runs list/show`: item, dispatched brief, steps, provider session + PR links, cost/quota, outcome. |
| 0070 | verified | task/0070-cli-trigger-dryrun-and-tail | Trigger, Dry-Run & Tail (`loopdog run` / `loopdog tail` / `loopdog watch`) | `loopdog run <loop> [--issue N] [--dry-run]`, `loopdog tail/watch` for live runs. |
| 0071 | verified | task/0071-cli-fleet-status-and-control | Fleet Status & Control (`loopdog status` + control verbs) | `loopdog status` overview + control of mode/budget/kill-switch from the CLI. |
| 0072 | verified | task/0072-cli-prompt-policy-inspection | Prompt & Policy Inspection (`loopdog prompts show/diff/edit/history`) | `loopdog prompts show/diff/edit`: view and version loop briefs/policies. |
| 0078 | verified | task/0078-custom-loop-authoring | Custom Loop Authoring (`loopdog loops new` questionnaire) | `loopdog loops new`: a short questionnaire that generates a per-loop template folder (`loop.yml` + `prompt.md`), prints its path to edit, validates, and offers a dry-run. |

## Definition Of Done

- [x] `loopdog loops show <loop>` reveals config, backend, the exact prompt
  (with its resolution source), and the transition step trace.
- [x] `loopdog runs show <run>` traces the item, briefRef, full step log,
  artifacts (PR/plan/session), and cost/outcome from the ledger.
- [x] An operator can trigger (`loopdog run`), dry-run (`--dry-run`), and tail
  (`loopdog tail/watch`) loops from the CLI.
- [x] `loopdog status` shows fleet state; `stop`/`resume-all`/`pause`/`resume`/
  `budget set`/`promote` set mode/budget/kill-switch.
- [x] Prompts are inspectable/diffable/lintable + editable with git history
  (`loopdog prompts show/diff/lint/edit/history`).
- [x] `loopdog loops new` scaffolds → validates → dry-runs a new loop with no
  core change (custom states auto-declared).

## Verification Log

- 2026-06-09: M16 verified; 188 tests green repo-wide. The CLI is the operator
  surface over the same three sources of truth (GitHub labels, the durable
  plan store, the run-record ledger) — no new datastore. `loopdog login` (M02)
  and `loopdog connect`/`promote`/`config` (M02/M05) round out the surface.
