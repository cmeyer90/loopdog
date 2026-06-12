# 0010 Subscription Onboarding & Backend Select

Status: implemented  
Branch: claude/laughing-johnson-8a7944

## Goal

A guided `looper connect` flow that links the adopter's **Claude and/or Codex
subscription** to a repo through the provider's validated repo-connect surface,
authorizes the repos, verifies the connection is live, and records a per-loop
backend choice — so loops dispatch to a provider cloud agent on the user's
subscription with **no model API keys on the primary path**.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md)
— the milestone's onboarding objective: "connect the adopter's Claude/Codex
subscription through the provider's validated surface (manual routine import for
Claude; provider App for Codex), authorize repos, pick the execution backend per
loop." This is the second half of the keyless connect story:
`looper login` (0077) authenticates the *user to GitHub* (OAuth device flow or
reused `gh`) and **chains into this task**, which connects the *provider*. It
predates and feeds the backends (M05 · [0019](0019-execution-backend-interface.md),
[0020](0020-claude-subscription-backend.md)) — provisioning routines/sessions is
theirs; this task only establishes and verifies the subscription link and writes
the backend selection that [0006](0006-config-schema-and-validation.md)'s
`backends:` / per-loop `backend:` keys validate. See
[architecture](../../docs/architecture.md) "Identity & secrets (two planes)" — the
**provider auth plane** — and "Dispatch surfaces." Lands in `@looper/cli` (the
flow) over `@looper/github` (provider-connect introspection) and `@looper/config`
(persisting selection); **no** looper GitHub App is introduced.

Claude-specific caveat resolved: public Claude Code GitHub Actions setup is a
separate API-key path (`ANTHROPIC_API_KEY`) and does not satisfy Looper's
subscription backend. Current Claude routine docs require API triggers/tokens to
be created in the Claude web UI. Therefore `looper connect claude` implements a
manual routine import flow: guide the user to create/edit the routine, select the
repo and Claude cloud environment, add an API trigger, copy the `/fire` URL and
one-time bearer token, and store them as GitHub Actions secret refs.

## Scope

- A `looper connect [<provider>]` command (also reachable as the tail of `looper
  init`/`looper login`) that walks the provider's repo-authorization surface:
  install the provider's GitHub App where required, or run the Claude manual
  routine import path.
- A live **verification probe** that confirms the App can act on the repo before
  declaring connected, or confirms the imported Claude routine secret refs and
  records the operator's repo/environment setup assertion for the routine path.
- Per-loop backend selection written to config; root default recorded too.
- A `looper connect --status` / connection state that the CLI and `init` preview
  read.

### Technical detail

**Providers & their install/import surfaces** (`@looper/cli/src/commands/connect.ts`,
with a small provider registry):

| Provider | Backend id | Install surface | Dispatch mode (capability, 0019) |
|---|---|---|---|
| Claude | `claude` | Manual Claude routine import: user-created routine with selected repo/environment + imported `/fire` URL and bearer-token secret refs | `api_fire` |
| Codex  | `codex`  | OpenAI Codex GitHub App install URL | `mention` only (no REST) |
| self-hosted | `self-hosted` | none — adopter brings own API key (M07) | local container |

The flow is **browser-handoff, not API-driven** for App installs (neither provider
exposes a programmatic App-install API): print/open the install URL via the
device's browser, instruct the user to choose the target repo(s) and grant access,
then **poll GitHub** for the installation rather than asking the user to paste an
App credential. For Claude, this command displays the exact web steps, accepts the
fire URL and bearer token once, writes them to Actions secrets (or records existing
secret names), and stores only `SecretRef`s plus non-secret setup assertions in
connection state. It never asks for `ANTHROPIC_API_KEY`.

`ConnectionState` (persisted to `~/.looper/connections.json` keyed by repo, *not*
committed; the OS-keychain token from 0077 stays in the keychain):

```ts
interface ProviderConnection {
  provider: "claude" | "codex" | "self-hosted";
  repo: string;                    // owner/name
  verified: boolean;               // provider access verified for repo
  method: "provider-app" | "routine-import" | "self-hosted";
  verifiedAt: string | null;       // ISO; last successful probe
  secretRefs?: { fireUrl?: string; fireToken?: string };
  notes?: string;                  // e.g. "ZDR org — use self-hosted"
}
```

**Verification probe** (`@looper/github`): for App-backed paths, list the repo's
installed GitHub Apps via `GET /repos/{owner}/{repo}/installation` / org
installations using the user token from 0077, and match the provider's known App
slug (`chatgpt-codex-connector` for Codex, plus any optional Claude-native
GitHub-trigger App only if that non-primary path is enabled; pinned in the
registry, surfaced as a known breakage point). A match with the repo in scope ⇒
`verified: true`, `method: "provider-app"`, `verifiedAt = now`. For Claude's
primary V1 path, the probe verifies that
the required fire URL/token secret refs exist and that the operator confirmed the
routine is bound to the target repo and Claude cloud environment. It does **not**
pretend this is a GitHub App install and does not fire the routine by default
(that spends quota); backend liveness is 0020/0093's concern.

**Backend selection.** After at least one provider verifies, prompt
(`@clack/prompts`) for a **root default backend** (`looper.yml`
`backends.default`) and, optionally, a **per-loop override** for each discovered
loop (writing `backend:` into `.looper/loops/<name>/loop.yml`). Selection is
constrained to verified providers (plus `self-hosted`, always selectable since it
needs no App). Writes go through `@looper/config`'s schema so they validate
immediately (0006); unverified-but-selected ⇒ a warning, not a hard fail (lets a
user pre-author then connect).

**Idempotent + resumable.** Re-running detects already-verified provider access
and skips to verification; a partial run (browser opened, App not yet installed,
or Claude token import not yet completed) resumes by re-polling or re-prompting.
Poll has a timeout (default 5 min) → prints the URL again and exits non-zero with
a resume hint, never hangs.

**ZDR / no-subscription edge cases.** If verification finds no provider access and
the user indicates a ZDR org or no subscription, the flow recommends the
`self-hosted` backend (M07) and records `notes`. Codex's mention-only constraint
and ~5-tasks/hr cap are surfaced as informational at selection time (from 0019
capabilities), not enforced here.

**CI note.** This is a **local CLI** flow only; the controller in Actions never
runs it (it uses `GITHUB_TOKEN` and the already-verified provider connection).
`looper connect --status` is read-only and safe to call anywhere.

## Out Of Scope

- GitHub *user* auth / device flow / keychain storage (0077).
- Routine/session provisioning, `/fire`, mention dispatch, quota reads (M05 ·
  0019/0020/0021).
- Self-hosted backend API-key handling and sandbox secret config (M07 · 0030).
- Config schema definition itself (0006) — this task *writes through* it.
- Loop authoring questionnaire (M16 · 0078).

## Acceptance Criteria

- [x] `looper connect claude` follows the manual routine import path (routine
      setup checklist + fire URL/token secret refs); `looper connect codex` opens
      the correct provider App install URL.
- [ ] **OPERATOR (live):** A live verification probe distinguishes "provider
      access verified for this repo" from "not connected," and only a verified
      provider is reported connected. (V1 reports secret-presence as
      "connected"; a true probe = firing the routine, which spends quota — the
      0093 spike kit is the manual probe until the live-smoke tier, 0087.)
- [x] Backend selection writes `backends.default` to `looper.yml` and optional
      per-loop `backend:` into `.looper/loops/<name>/loop.yml`, validated by 0006.
- [x] Only verified providers (plus `self-hosted`) are offered as selectable
      backends; selecting an unverified one warns.
- [x] The flow is idempotent and resumable; a re-run on an already-connected
      repo is a no-op (secret presence detected; `--rotate` re-imports); the
      verification poll is deferred with the live probe above.
- [x] ZDR / no-subscription users are routed to `self-hosted` with a recorded note.
- [x] No model API key is requested or stored on the Claude/Codex paths; no looper
      GitHub App is introduced.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the provider registry (App slug/install URL where applicable, Claude
      manual routine import method, dispatch mode) in `@looper/cli`.
- [x] Implement `looper connect [<provider>]` + `--status` with `@clack/prompts`,
      browser-open + poll-for-installation for App paths, and the Claude routine
      setup/import checklist + secret-ref capture.
- [x] Add the installation/verification probe to `@looper/github` (`installation`
      lookup by App slug for App paths; Claude secret-ref/setup assertion checks
      for routine import).
- [x] Implement backend selection writes through `@looper/config` (root default +
      per-loop override).
- [x] Persist `ProviderConnection` state; make the flow idempotent/resumable with a
      poll timeout.
- [x] Handle ZDR / no-subscription → recommend self-hosted; surface Codex
      mention-only + rate-cap notes.
- [x] Chain from `looper login` (0077) and `looper init` (0007); update connect
      docs/walkthrough.

## Test Plan

Tests run via the repo's `vitest` runner; all GitHub/provider IO behind the M18
fakes (in-memory GitHub from [0083](0083-fake-github.md)) — **no real quota, no
real network**.

```bash
# replace with this repo's checks
pnpm --filter @looper/cli test    # connect flow: authorize/import→verify→select
pnpm --filter @looper/github test # provider-connect probe matches/doesn't match
```

- Component: probe returns `verified:true` with the expected `method` only when
  fake GitHub / fake Claude connect state reports provider access scoped to the
  repo; `false` otherwise.
- Scenario: full `connect` run on fake GitHub / fake Claude connect state —
  simulate "provider access appears after N polls/prompts" → state becomes
  verified; selection writes valid config (re-validated via 0006).
- Edge: poll timeout exits non-zero with resume hint; re-run on connected repo is a
  no-op; ZDR path recommends self-hosted and records the note.

## Verification Log

- 2026-06-09: `looper connect claude` / `connect codex` implemented and smoke-
  tested non-interactively (prints the guided steps + manual gh fallback).
  Live secret-set + provider round-trip require real subscriptions (operator;
  spike 0093 RUNBOOK is the validation kit).

## Decisions

- Claude connect = the 0093 manual-routine-import decision verbatim: guided
  web-UI steps (routine, repo+cloud env selection — env vars configured IN
  Claude, branch-push permissions, API trigger), then the /fire URL + token
  imported as `LOOPER_CLAUDE_FIRE_URL` / `LOOPER_CLAUDE_FIRE_TOKEN` Actions
  secrets via `gh secret set` (values read with hidden input, never echoed,
  never written to disk). Rotation = regenerate in Claude + re-run connect.
- Codex connect = provider-App authorization guidance + the 0092/0093 finding
  surfaced honestly: the mention identity must be linked to the ChatGPT
  account, so automation needs the adopter's own attributable identity
  (`LOOPER_CODEX_MENTION_TOKEN` PAT) — a bot identity cannot spend quota.
- Backend selection per loop is config (0006 `backend:` + root default);
  no separate selection wizard in V1.

## Risks / Rollback

Provider connect surfaces (App slugs/install URLs, Claude routine import UI) are
external and may drift — pin known values in the registry and fail with a clear
manual fallback so a surface change degrades to a guided step, not a hard break.
No state is written to the repo until a provider verifies (or the user
explicitly chooses self-hosted), so an aborted run leaves the repo clean; rollback
is deleting `connections.json` and re-running. The ToS question (architecture
"open ToS question"; spike
[0092](0092-tos-and-subscription-automation-spike.md)) is acknowledged in the
connect output, not resolved here.

## Final Summary

`looper connect claude` guides the manual routine import end-to-end and
stores the /fire URL + bearer token as Actions secret refs; `looper connect
codex` guides provider-App authorization and the user-attributable mention
identity. Per-loop backend choice is plain config. No model API keys anywhere
on this path.
