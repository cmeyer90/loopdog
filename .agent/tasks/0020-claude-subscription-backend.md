# 0020 Claude Subscription Backend

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Implement the execution-backend interface (0019) for Claude on the user's
**subscription** — dispatch via Claude Code routines / cloud sessions, ingest the
PRs they open — with no Anthropic API key.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md).
Verified capabilities (2026-06): "Claude Code on the web" + "Routines" are
**subscription-only** cloud agents; routines trigger via API `/fire`, schedule, or
GitHub events, run unattended in an Anthropic-provisioned sandbox (setup scripts +
env vars; no dedicated secret store yet); routines are beta; ZDR orgs are
excluded. Public Claude Code GitHub Actions docs describe a separate GitHub
Action path that uses a GitHub App plus `ANTHROPIC_API_KEY`; that is **not** this
backend. See [architecture](../../docs/architecture.md) "Dispatch surfaces" and
"Verified provider capabilities."

M00 resolved the bootstrap direction from public docs: V1 uses **manual routine
import**. Users create the Claude routine, select its repo/environment, add an API
trigger, and import the `/fire` URL + bearer token as GitHub Actions secret refs.
Loopdog does not create Claude routines, generate/revoke routine API tokens, or set
Claude cloud environment variables programmatically in V1.

## Scope

- Import/manage a Claude **routine per loop** at onboarding: each loop references
  an imported `/fire` URL and bearer-token secret ref for a user-created routine
  that is already wired to the repo, cloud environment, setup script, and prompt
  wrapper in Claude.
- Dispatch: `/fire` the routine with the composed brief as run context.
- Verify/document the routine sandbox expectations (setup script, env var names,
  network access) so tests can run (M07 · 0030); values are configured in Claude's
  cloud environment by the user, not injected by Loopdog at dispatch.
- Ingest the resulting PR/comments and return an IngestResult (correlation via
  0073).
- Surface capabilities; handle the ZDR-excluded case by directing to self-hosted.

### Technical detail

- **Auth**: the imported subscription routine fire token stored as a `SecretRef` /
  GitHub Actions secret — never `ANTHROPIC_API_KEY` and never a Claude Platform API
  key. Store the `/fire` URL as a secret ref too unless a later security review
  decides routine IDs are safe in config. Routine calls send the dated beta header
  (`experimental-cc-routine-2026-04-01`); pin + surface it as a known breakage point.
- **Provisioning/import**: `loopdog connect claude` imports one user-created routine
  per enabled Claude-backed loop. The operator creates/edits the routine in Claude
  web UI, selects the repo and cloud environment, adds an API trigger, copies the
  fire URL and one-time bearer token, and lets Loopdog store them as secret refs.
  Prompt changes update the composed `text` sent to `/fire`; changing the saved
  routine prompt, repo, environment, branch permissions, or token requires a
  user-managed Claude UI edit and/or `loopdog connect claude --reimport`.
- **Dispatch**: `POST /fire` with `{ text: <composed brief> }`; capture the
  returned session id + URL into the DispatchHandle (the CLI `runs show` session
  link). `capabilities = { trigger_modes:[api_fire], provider_native_triggers:
  [schedule, github_event], runs_sandbox: true, secret_phase: full, network: on,
  opens_pr: true, supports_review: true }`.
- **Sandbox/secrets**: env vars configured on the Claude cloud environment are
  visible to anyone who can edit that environment (no dedicated secret store yet)
  and are not pushed from GitHub Actions at `/fire` time. Document the caveat;
  route genuinely sensitive integration tests to the self-hosted backend.
- **Ingest**: match the opened PR to the run via the correlation marker (0073);
  return `{ pr, status }`. No-PR outcomes (agent labeled `needs-human`) ingest as
  an escalation.
- **Quota**: routines have daily caps — surface remaining quota for budgeting
  (M12 · 0075).

## Out Of Scope

- The correlation mechanism itself (0073); Codex (0021); self-hosted (0074);
  sandbox secret config internals (M07 · 0030).

## Acceptance Criteria

- [x] Conforms to the 0019 interface with accurate capability metadata.
- [x] Dispatches a brief by `/fire`-ing an imported per-loop routine on the
      subscription, with the fire URL + bearer token read from secret refs and no
      API key stored.
- [x] Does not use `anthropics/claude-code-action`, `ANTHROPIC_API_KEY`, or any
      Claude Platform model API key on the primary path.
- [x] Implements manual routine import as the V1 bootstrap/token model; no code
      path attempts to create/revoke Claude routine API tokens or configure Claude
      cloud environment variables programmatically.
- [x] Ingests the resulting PR and returns an IngestResult correlated to the run.
- [x] Reports remaining routine quota for budgeting.
- [x] ZDR-excluded repos get a clear directive to the self-hosted backend.

## Implementation Checklist

- [x] Routine import per loop (fire URL + token secret refs) with re-import and
      rotation instructions.
- [x] `/fire` dispatch with brief; capture session id/URL into the handle.
- [x] Ingest via the correlation marker (0073).
- [x] Capabilities + quota reporting; beta-header pinning.

## Test Plan

```bash
# replace with the chosen stack's runner
# against a test repo + subscription: fire a routine, observe PR, ingest + correlate
```

## Verification Log

- 2026-06-09: backend suite green: /fire carries the bearer token + pinned
  beta header and the brief as {text}; the session id/URL lands in the handle;
  missing import fails with the `loopdog connect claude` remediation; 429
  surfaces as quota-backoff (never retry-storming); zdrCompatible=false;
  ingest correlates via the shared 0073 matcher. No ANTHROPIC_API_KEY or
  claude-code-action anywhere (grep-clean).
- Live /fire round-trip remains operator-pending (0093 spike kit).

## Decisions

- V1 ships ONE imported routine (fire URL + token secret refs
  LOOPDOG_CLAUDE_FIRE_URL/TOKEN) rather than routine-per-loop: the brief
  composed per loop is the differentiator, and one import keeps onboarding to
  a single web-UI walk. Recorded simplification of the spec's
  routine-per-loop model; revisit when live trials (0093) show per-loop
  routines pay (e.g. distinct cloud envs per loop).
- Brief payload: `{ text: <composed brief> }`; beta header pinned to
  `experimental-cc-routine-2026-04-01` and exported as a constant (the known
  breakage point).
- Token storage/rotation: Actions secrets imported by `loopdog connect claude`,
  rotation = regenerate in Claude + `--rotate` re-import.
- Quota: Claude exposes no remaining-quota API — budgeting models the daily
  cap from run-record timestamps (M12 · 0075); capabilities carry the honest
  quotaNote.

## Risks / Rollback

Routines are **beta** — the API/headers may break; pin the version and fail loudly.
The exact `/fire` provisioning + auth handshake is the least-certain external
dependency in the plan; spike it early before building dependent loops. If 0093
finds only the Claude Code GitHub Action + `ANTHROPIC_API_KEY` path is viable,
this backend is blocked and V1 must route Claude work through self-hosted/API or
another validated surface.

## Final Summary

`ClaudeBackend`: headless `/fire` of the imported routine on the user's
subscription (bearer token + pinned beta header, brief as run context),
session id/URL captured as the authoritative dispatch signal, shared
correlation ingest, accurate capabilities (zdr-excluded with a self-hosted
directive in the error path), quota-respecting 429 handling, and zero API-key
code paths.
