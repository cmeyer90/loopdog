# Spike 0093 Runbook — operator steps (requires real subscriptions)

> These are the manual steps a human operator performs once per provider. They
> are also the draft of what `looper connect claude` / `looper connect codex`
> must display (tasks 0010 / 0077 / 0020 / 0023 consume this).

## 1. Claude — manual routine / API-trigger import

Per current public Claude docs (2026-06): routines and their API triggers are
created **in the Claude web UI only**; the CLI cannot create or revoke API
trigger tokens. The spike therefore validates the *import* flow looper V1 uses:

1. In Claude (web), open **Claude Code → Routines** and create a routine:
   - **Repository:** select the scratch repo (authorize Anthropic's GitHub App
     for it if prompted — this is the *provider's* App, not a looper App).
   - **Cloud environment:** pick/create one; note that env vars and setup
     scripts for the sandbox are configured **here**, in Claude — looper never
     forwards Actions secrets at `/fire` time.
   - **Branch-push permissions:** allow the routine to create branches/PRs.
   - **Prompt:** any placeholder; the `/fire` call supplies the real brief.
2. Add an **API trigger** to the routine. Claude shows a per-routine **fire
   URL** and a **bearer token** (shown once — copy it now).
3. In the scratch repo: `Settings → Secrets and variables → Actions` and add:
   - `LOOPER_SPIKE_CLAUDE_FIRE_URL` = the fire URL
   - `LOOPER_SPIKE_CLAUDE_FIRE_TOKEN` = the bearer token
4. Record while you're there (feeds 0020/0023):
   - Can the token be **regenerated**? What happens to the old one?
   - Can the trigger be **revoked**? Does the routine survive token rotation?
   - Does the routine show a **session log/URL** per fire?
5. Run the `spike-claude-fire` workflow (`workflow_dispatch`). Confirm:
   - HTTP 2xx from `/fire` with **no** `ANTHROPIC_API_KEY` anywhere.
   - A session appears in Claude; a branch/PR lands in the scratch repo.
   - The `/fire` JSON response (saved as the run artifact) contains a session
     id/URL — the non-agent-dependent correlation signal.

## 2. Codex — provider App + @codex mention

1. Install/authorize the **OpenAI Codex GitHub App** for the scratch repo
   (Codex cloud onboarding, signed in with the ChatGPT subscription account).
2. Open issue #1 in the scratch repo (any text).
3. Run the `spike-codex-mention` workflow. **Key observation:** does Codex
   react to a mention posted by `github-actions[bot]`? If it ignores
   bot-authored mentions, record that — looper would need the mention to come
   from a user-attributable identity (e.g. a PAT), which changes 0021.
   - Control: post the same `@codex …` text manually as the human; confirm
     Codex reacts to that.
4. Record the identity that opens the resulting PR (e.g. `codex[bot]` /
   `chatgpt-codex-connector`) — feeds 0073's actor allow-list.

## 3. Event probe

With `spike-event-probe.yml` installed in the scratch repo:

1. Let a provider (either one) open a PR → check the Actions tab: did
   `spike-event-probe` run for `pull_request.opened`? Record actor + sender
   type from the job summary. Expected: **yes** (provider Apps are not
   `GITHUB_TOKEN`, so their events dispatch workflows).
2. Control: have a workflow using `GITHUB_TOKEN` open a PR (e.g. `gh pr create`
   in a quick test workflow) → expected: **no** probe run (the documented
   `GITHUB_TOKEN` no-retrigger rule that makes the cron sweep load-bearing).

## 4. Correlation trials

1. `scripts/correlation-trial.sh claude 10` (spaced for daily caps), same for
   `codex` (≤5/hr on lower tiers — keep the default 15-min spacing).
2. After PRs settle: `SPIKE_REPO=<owner/name> scripts/correlation-score.sh`.
3. Paste the score table into the task file verification log; the "both
   honored" rate decides 0073's design (see README).

## Rate/UX cautions

- Each Claude fire consumes routine/subscription quota; each Codex task counts
  against cloud-task caps. Keep N modest (10/provider) and space trials.
- Run in a **scratch repo only**; trials open real branches/PRs.
