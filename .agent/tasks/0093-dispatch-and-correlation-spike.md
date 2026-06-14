# 0093 Dispatch & Correlation Spike

Status: blocked  
Branch: claude/laughing-johnson-8a7944 (spike artifacts; live trials pending operator)

## Goal

Prove — on real subscriptions, with throwaway code — that loopdog's load-bearing
dispatch primitives actually work headlessly: a Claude routine `/fire`, a `@codex`
round-trip, and reliable correlation of the resulting PR back to the run.

## Background

Part of [Milestone 00](../milestones/milestone-00-pre-build-validation-spikes.md).
The plan review flagged three coupled HIGH/BLOCKER risks here: (a) routines are
beta and may not issue a storable headless token (0020 calls `/fire` "the least-
certain external dependency"); (b) correlation (0073) relies on the *agent obeying*
brief instructions (branch name + PR trailer) — LLM compliance, not protocol — and
a miss double-dispatches or strands work; (c) the "provider-App PR fires the event
instantly" assumption (0008) is unverified. Building M05 on an unvalidated `/fire`
+ correlation contract risks reworking the entire dispatch core.

Claude has two easily-confused public surfaces: Claude Code GitHub Actions, which
is documented around a GitHub App plus `ANTHROPIC_API_KEY`, and Claude Code
routines, which are subscription/cloud sessions triggered by a per-routine bearer
token. Loopdog's primary path depends on the second surface only.

**Resolved finding (2026-06 docs review):** public Claude docs support headless
`/fire` after a routine already exists, but routine API triggers and tokens are
created from the Claude web UI and the CLI cannot create or revoke those API
tokens. Therefore V1 should implement **manual routine token import**, not
automated Claude routine provisioning. The remaining spike work is to prove that
an imported routine can be fired from GitHub Actions, can access the intended repo
and environment, and can produce a branch/PR that Loopdog can correlate.

## Scope

- **Claude:** manually create/import a routine/API trigger on a *subscription*,
  store the per-routine `/fire` URL + bearer token as GitHub Actions secret refs,
  `/fire` it headless from Actions (no browser), confirm it can produce a branch
  or PR, and check token rotation/import semantics.
- **Claude bootstrap reality:** treat routine creation, API-trigger creation,
  token generation/revocation, repo selection, cloud environment selection, setup
  script, and branch-push permissions as **user-managed Claude web UI setup** for
  V1. Loopdog records/imports the resulting fire URL/token refs and verifies the
  runtime behavior; it does not automate these setup steps unless future public
  docs add a supported API.
- **Claude cloud environment:** for routines, project-specific env vars/setup
  scripts are configured in Claude's cloud environment, not forwarded from GitHub
  Actions at `/fire` time. Loopdog should track expected env var names and warn
  when sensitive/live credentials imply self-hosted instead.
- **Claude surface separation:** prove the above uses neither
  `anthropics/claude-code-action` nor `ANTHROPIC_API_KEY`; if the only viable path
  is the public GitHub Action/API-key path, mark the subscription-primary Claude
  backend blocked.
- **Codex:** post an `@codex` mention/assignment, confirm a correlatable PR/comment
  results, note what identity opens it and whether *any* dispatch-time handle exists.
- **Correlation:** over N runs per provider, measure how often the agent honors the
  branch-name (`loopdog/<loop>/<issue>-<run_id>`) and PR-trailer (`loopdog-run:`)
  instructions; identify a **non-agent-dependent** signal (e.g. the `/fire` session
  id mapped via provider API) if compliance is unreliable.
- **Events:** confirm a provider-App-opened PR actually fires the adopter's
  `pull_request` workflow under `GITHUB_TOKEN`-only auth.

## Out Of Scope

- Production backend code (M05); the real correlation implementation (0073) — this
  spike *informs* it.

## Acceptance Criteria

- [ ] A headless Claude `/fire`, using an imported fire URL + bearer token stored
      as GitHub Actions secret refs, produces a branch or PR (or a documented
      blocker), with token rotation/re-import behavior understood.
- [ ] The Claude routine bootstrap path is implemented as manual routine token
      import for V1; downstream tasks 0010/0020/0023/0030/0077 reflect that Loopdog
      does not create routines/tokens or push Claude env vars at dispatch time.
- [ ] The Claude path is confirmed to avoid `ANTHROPIC_API_KEY` and the Claude Code
      GitHub Action, or the blocker is documented as a V1 go/no-go issue.
- [ ] A `@codex` dispatch yields a correlatable result, with its handle/identity
      characteristics documented.
- [ ] Measured per-provider correlation-signal reliability over N runs, and a
      decision on whether 0073 needs a non-agent-dependent signal.
- [ ] Verified whether provider-App PRs fire events (feeds 0008/ingest latency).

## Implementation Checklist

- [x] Read and snapshot the current Claude routine and Claude Code GitHub Actions
      docs so the spike does not conflate the API-key Action path with routines.
      (2026-06-10 docs review, see Verification Log; surface separation is encoded
      in the spike scripts — no `ANTHROPIC_API_KEY`, no `claude-code-action`.)
- [x] Build the throwaway spike kit: `spikes/0093-dispatch-correlation/`
      (claude-fire + codex-mention scripts, correlation trial/score scripts,
      Actions workflows, event probe, operator RUNBOOK).
- [ ] **OPERATOR (live subscription required):** run RUNBOOK §1 — manual Claude
      routine/API-trigger creation, token generation/regeneration/revocation,
      repo + cloud env selection, branch-push permissions; record exact steps.
- [ ] **OPERATOR (live):** import fire URL + token as Actions secrets; run
      `spike-claude-fire` round-trip; record token behavior.
- [ ] **OPERATOR (live):** `spike-codex-mention` round-trip; record identity +
      handle + whether Codex reacts to a bot-authored mention (RUNBOOK §2).
- [ ] **OPERATOR (live):** N correlation trials per provider
      (`correlation-trial.sh`); tabulate honor-rate (`correlation-score.sh`).
- [ ] **OPERATOR (live):** observe provider-PR → event firing (RUNBOOK §3).
- [x] Write findings + design consequences into the downstream task specs: 0073
      must use a dual-signal correlation (dispatch-time signal authoritative,
      agent-obeyed signals as accelerators) — see Decisions.

## Test Plan

```text
Throwaway scripts against real test repos + real subscriptions; capture transcripts.
```

## Verification Log

- 2026-06-10: Official Claude docs rechecked for planning. They support headless
  `/fire` for an existing routine using a per-routine bearer token created in the
  Claude web UI; API trigger/token creation and revocation are not public-API or
  CLI operations. Updated downstream planning to implement manual routine import,
  avoid `ANTHROPIC_API_KEY` / `anthropics/claude-code-action`, and treat Claude
  cloud env/setup as user-managed in Claude rather than forwarded at dispatch.
- 2026-06-09: Built the throwaway spike kit under `spikes/0093-dispatch-correlation/`
  (scripts + workflows + RUNBOOK; shellcheck-clean bash, executable bits set).
  Live execution is **blocked in this environment**: it requires a human-owned
  Claude/Codex subscription, a scratch GitHub repo, and the Claude web UI — none
  of which an offline agent session can exercise. All live steps are enumerated
  as OPERATOR items in the checklist and RUNBOOK; the kit is copy-paste runnable.

## Decisions

- Claude bootstrap decision (2026-06-10, from docs): V1 uses manual
  routine/API-trigger import. Secret-ref names standardized by the spike kit:
  `LOOPDOG_CLAUDE_FIRE_URL` / `LOOPDOG_CLAUDE_FIRE_TOKEN` (spike uses a
  `LOOPDOG_SPIKE_`-prefixed pair). Operator steps are RUNBOOK §1 and are the
  draft copy for `loopdog connect claude` (0010/0077).
- **Correlation design decision (2026-06-09, adopted without waiting for live
  honor-rates):** 0073 MUST implement **dual-signal correlation** — the
  **dispatch-time, non-agent-dependent signal is authoritative** (Claude: the
  `/fire` response session id/URL recorded at dispatch; Codex: the mention
  comment id + time window + provider-App actor), and the agent-obeyed signals
  (branch `loopdog/<loop>/<issue>-<run_id>`, PR trailer `loopdog-run: <run_id>`)
  are **accelerators, never the only key**. Rationale: LLM compliance is not a
  protocol; designing for the unreliable case is strictly safer and costs one
  extra recorded field per dispatch. Live trials can only *relax* this (they
  cannot make agent-obeyed signals trustworthy at 100%), so implementation is
  not blocked on them.
- Codex bot-mention risk recorded for 0021: if Codex ignores mentions authored
  by `github-actions[bot]`, dispatch needs a user-attributable identity (PAT)
  — RUNBOOK §2 step 3 resolves this empirically; 0021 must carry both paths.

## Risks / Rollback

If `/fire` isn't headless-usable or correlation is unreliable, M05's design needs
rework *before* it's built — which is exactly why this runs first.

## Final Summary

Partial (agent-completable scope done; live trials operator-pending). Delivered
the complete throwaway spike kit (`spikes/0093-dispatch-correlation/`: fire &
mention dispatch scripts with dispatch-time signal capture, correlation
trial/score harness, three Actions workflows incl. the provider-PR event probe,
and the operator RUNBOOK that doubles as `loopdog connect` copy). Made the
load-bearing design call downstream tasks needed from this spike — dual-signal
correlation with the dispatch-time signal authoritative — so M05/0073 are not
design-blocked on live honor-rate numbers. Remaining: the five OPERATOR items
(real-subscription round-trips and measurements), which only a human with
Claude/Codex accounts and a scratch repo can run.
