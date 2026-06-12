# Milestone 07: Secrets & Identity (two-plane, subscription-native)

Status: verified

> Background: [Looper Architecture](../../docs/architecture.md) — "Identity &
> secrets (two planes)" and the execution-model constraints (provider-cloud secret
> residency; Codex agent-phase secret stripping). Rule: the model never sees a
> long-lived credential, only the result of having one.

## Objective

Give looper a scoped repo identity and a two-plane secret model: a **provider auth
plane** (the user's subscription through the provider's validated repo-connect
surface — Claude routine import, Codex provider App, usually no model API key to
store) and a **project-secret plane** (the build/test/deploy secrets the work cell
needs, configured into the provider's cloud environment on the primary path, or
the adopter's runner on the self-hosted backend), with the trust boundary
documented honestly.

## Guiding Decisions

- **Looper's repo identity = the Actions `GITHUB_TOKEN`** — free, zero-setup. The
  loop-to-loop handoffs it won't re-trigger are carried by the **cron sweep**
  (M02 · 0076), so **no looper GitHub App is required for V1** (optional PAT for
  instant handoff; a full looper App is post-V1). Local CLI auth is OAuth device
  flow (public client_id, no backend) or the user's existing `gh`/git.
- Provider auth = subscription through the **provider's** validated surface:
  Claude routine import (`/fire` URL + bearer-token secret refs) and Codex's
  provider App. No long-lived model API key on the primary path.
- Project secrets for the work cell live in the **provider's** cloud env (setup
  scripts + env vars) on the primary path; for Claude routines, adopters configure
  them in Claude's cloud environment and Looper does not forward Actions secrets
  at `/fire` time. Adopters accept that residency.
- Codex strips secrets before the agent phase and disables agent-phase internet by
  default — document what tests can/can't run there, and lean on the adopter's CI
  (ladder rung 2) as the trustworthy gate.
- The self-hosted backend uses the adopter's own secret store (Actions secrets /
  OIDC / Vault / Doppler) injected into the adopter's self-hosted container/runner,
  with leak guards — recovering full secret/network access the provider sandbox
  restricts.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0029 | verified | task/0029-provider-auth-and-scoped-identity | Repo Identity & Provider Auth | Repo identity = Actions `GITHUB_TOKEN` + cron sweep for handoff (optional PAT for instant); local `looper login` via OAuth device flow / `gh`; provider subscription via Claude routine import / provider App. No looper GitHub App, no manual PATs required. |
| 0030 | verified | task/0030-provider-cloud-env-and-secrets | Provider Cloud Env & Secret Config | Configure provider sandbox setup scripts + env vars/secrets so tests run. |
| 0031 | verified | task/0031-self-hosted-secret-injection-and-leak-guards | Self-Hosted Secret Injection & Leak Guards | Pluggable backends + sandbox injection + scrubbing for the self-hosted path. |
| 0032 | verified | task/0032-secret-trust-boundary-doc | Secret Trust-Boundary & Constraints Doc | Document residency, Codex stripping/no-internet, and what each path can verify. |

## Definition Of Done

- [x] Repo identity = Actions `GITHUB_TOKEN` (sweep handoffs; optional
  LOOPER_PAT for instant; fork-readonly defer) — no looper GitHub App; provider
  auth = subscription surfaces only, no model API key on the primary path.
- [x] The work cell can get the secrets it needs per path: provider cloud env
  declared + checklisted (Claude web-UI residency honored, nothing forwarded),
  Codex setup-only marking, self-hosted real injection from four store kinds.
- [x] Codex agent-phase constraints documented (trust-boundary doc + 0021
  mismatch check) with the adopter's CI as the trustworthy gate.
- [x] `docs/trust-boundary.md` states residency per backend, with doc-sync
  assertions; referenced from connect flows and SECURITY.md.

## Verification Log

- 2026-06-09: all four tasks verified; 165 tests green repo-wide (identity
  precedence/handoff/fork suites, provider-env resolution, secret stores,
  scrubber incl. encodings + fail-closed, doc-sync governance assertions).
