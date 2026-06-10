# Spike 0093 — Dispatch & Correlation (THROWAWAY)

> Throwaway validation code for task
> [`0093-dispatch-and-correlation-spike`](../../.agent/tasks/0093-dispatch-and-correlation-spike.md)
> (Milestone 00). **Not production code. Not imported by any package. Delete
> after Milestone 00 closes.**
>
> Everything here is designed to be copied into a **scratch repository** and run
> with **real subscriptions by a human operator** — the two external resources
> this spike validates and that cannot be exercised from an offline checkout.

## What this spike proves (or documents as blocked)

| # | Question | Artifact |
|---|---|---|
| 1 | Can an imported Claude routine `/fire` URL + bearer token, stored as Actions secrets, dispatch headlessly from CI? | `workflows/spike-claude-fire.yml` + `scripts/claude-fire.sh` |
| 2 | Does a `@codex` mention/assignment posted by automation yield a Codex cloud task and PR? | `workflows/spike-codex-mention.yml` + `scripts/codex-mention.sh` |
| 3 | How often does the agent honor the branch-name and PR-trailer correlation instructions? | `scripts/correlation-trial.sh` + `scripts/correlation-score.sh` |
| 4 | Does a provider-App-opened PR fire the adopter's `pull_request` workflow under `GITHUB_TOKEN`-only auth? | `workflows/spike-event-probe.yml` |
| 5 | What are the exact operator steps for manual Claude routine import? | `RUNBOOK.md` |

## How to run

1. Create a **scratch repo** (private is fine) and push this `spikes/0093-dispatch-correlation/`
   directory's `workflows/*.yml` into `.github/workflows/`.
2. Follow `RUNBOOK.md` §1 to create the Claude routine in the Claude web UI and
   import `LOOPER_SPIKE_CLAUDE_FIRE_URL` + `LOOPER_SPIKE_CLAUDE_FIRE_TOKEN` as
   Actions secrets in the scratch repo.
3. Trigger `spike-claude-fire` via `workflow_dispatch` (inputs: `issue`, `run_id`).
4. Follow `RUNBOOK.md` §2 for the Codex provider-App install, then trigger
   `spike-codex-mention`.
5. Run `scripts/correlation-trial.sh` N times per provider (default N=10), then
   `scripts/correlation-score.sh` to tabulate honor-rates.
6. Record results in the task file's verification log and decisions.

## Correlation contract under test

Dispatch embeds two **agent-obeyed** signals in the brief:

- branch name: `looper/<loop>/<issue>-<run_id>`
- PR body trailer: `looper-run: <run_id>`

…and captures one **non-agent-dependent** signal at dispatch time:

- Claude: the `/fire` HTTP response (session id / session URL) — recorded by
  `claude-fire.sh` into the run log before the agent does anything.
- Codex: the mention comment's own id + timestamp window + the provider App's
  actor identity on the resulting PR.

The score script measures how often the agent-obeyed signals survive, which
decides (for 0073) whether correlation may rely on them or must key off the
dispatch-time signal.
