# 0093 Dispatch & Correlation Spike

Status: ready  
Branch: task/0093-dispatch-and-correlation-spike

## Goal

Prove — on real subscriptions, with throwaway code — that looper's load-bearing
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
token. Looper's primary path depends on the second surface only.

**Resolved finding (2026-06 docs review):** public Claude docs support headless
`/fire` after a routine already exists, but routine API triggers and tokens are
created from the Claude web UI and the CLI cannot create or revoke those API
tokens. Therefore V1 should implement **manual routine token import**, not
automated Claude routine provisioning. The remaining spike work is to prove that
an imported routine can be fired from GitHub Actions, can access the intended repo
and environment, and can produce a branch/PR that Looper can correlate.

## Scope

- **Claude:** manually create/import a routine/API trigger on a *subscription*,
  store the per-routine `/fire` URL + bearer token as GitHub Actions secret refs,
  `/fire` it headless from Actions (no browser), confirm it can produce a branch
  or PR, and check token rotation/import semantics.
- **Claude bootstrap reality:** treat routine creation, API-trigger creation,
  token generation/revocation, repo selection, cloud environment selection, setup
  script, and branch-push permissions as **user-managed Claude web UI setup** for
  V1. Looper records/imports the resulting fire URL/token refs and verifies the
  runtime behavior; it does not automate these setup steps unless future public
  docs add a supported API.
- **Claude cloud environment:** for routines, project-specific env vars/setup
  scripts are configured in Claude's cloud environment, not forwarded from GitHub
  Actions at `/fire` time. Looper should track expected env var names and warn
  when sensitive/live credentials imply self-hosted instead.
- **Claude surface separation:** prove the above uses neither
  `anthropics/claude-code-action` nor `ANTHROPIC_API_KEY`; if the only viable path
  is the public GitHub Action/API-key path, mark the subscription-primary Claude
  backend blocked.
- **Codex:** post an `@codex` mention/assignment, confirm a correlatable PR/comment
  results, note what identity opens it and whether *any* dispatch-time handle exists.
- **Correlation:** over N runs per provider, measure how often the agent honors the
  branch-name (`looper/<loop>/<issue>-<run_id>`) and PR-trailer (`looper-run:`)
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
      import for V1; downstream tasks 0010/0020/0023/0030/0077 reflect that Looper
      does not create routines/tokens or push Claude env vars at dispatch time.
- [ ] The Claude path is confirmed to avoid `ANTHROPIC_API_KEY` and the Claude Code
      GitHub Action, or the blocker is documented as a V1 go/no-go issue.
- [ ] A `@codex` dispatch yields a correlatable result, with its handle/identity
      characteristics documented.
- [ ] Measured per-provider correlation-signal reliability over N runs, and a
      decision on whether 0073 needs a non-agent-dependent signal.
- [ ] Verified whether provider-App PRs fire events (feeds 0008/ingest latency).

## Implementation Checklist

- [ ] Read and snapshot the current Claude routine and Claude Code GitHub Actions
      docs so the spike does not conflate the API-key Action path with routines.
- [ ] Test manual Claude routine/API-trigger creation, token generation, token
      regeneration, token revocation, repo selection, cloud environment selection,
      and branch-push permissions from the web UI; record the exact operator steps
      that `looper connect claude` must display.
- [ ] Store/import fire URL + token as GitHub Actions secret refs and run a
      throwaway Claude `/fire` round-trip from Actions; record token behavior.
- [ ] Throwaway `@codex` round-trip; record identity + handle.
- [ ] Run N correlation trials per provider; tabulate honor-rate.
- [ ] Observe provider-PR → event firing.
- [ ] Write findings + recommendations into 0010 / 0020 / 0023 / 0077 / 0073 / 0008.

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

## Decisions

Claude bootstrap decision: V1 uses manual routine/API-trigger import. Record the
secret names/ref format for the fire URL and token, the operator web-setup steps,
the provider identity that opens branches/PRs, the correlation honor-rates, and
whether a non-agent-dependent correlation signal is mandated for 0073.

## Risks / Rollback

If `/fire` isn't headless-usable or correlation is unreliable, M05's design needs
rework *before* it's built — which is exactly why this runs first.

## Final Summary

Fill this in before marking verified.
