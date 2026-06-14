# 0023 Backend Selection & Subscription Auth

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Resolve, for any given transition, **which execution backend runs it** (per-loop,
overridable per-stage) and **which subscription credential that backend
authenticates with** — so the runner hands a chosen, authenticated `Backend` to
the dispatch step (M03 · 0012) without ever storing a long-lived model API key on
the primary path.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md):
the milestone defines the one execution-backend contract (0019) and implements it
for Claude (0020), Codex (0021), and self-hosted (0074); this task is the
**selection + auth resolution layer** that sits between them and the runner. It
also bridges to [Milestone 07](../milestones/milestone-07-secrets-and-identity.md)
("Identity & secrets — two planes"): provider auth = the user's subscription via
the provider's validated surface (Claude routine import or Codex provider App),
never an API key on the happy path. Onboarding UX (Claude routine import, App
install where applicable, repo authorization, the picker prompt) is M02 · 0010;
keyless local login is M02 · 0077; this task consumes their stored results.
See [architecture](../../docs/architecture.md) "Generic-ness, in three plugin
systems" (point 3) and "Identity & secrets (two planes)." Lands in
`@loopdog/backends` (the registry + auth resolver) and `@loopdog/config` (the
`backends.default`/`backends.review` schema); selection is invoked from
`@loopdog/runtime`.

Claude caveat: do not treat Claude Code GitHub Actions auth as subscription auth.
That public path uses `ANTHROPIC_API_KEY`; Loopdog's Claude backend must resolve
only imported Claude routine `/fire` credentials. Public docs require creating API
triggers/tokens from the Claude web UI, so V1 auth resolution is manual routine
import, not automated routine/token provisioning.

## Scope

- A **backend registry** in `@loopdog/backends`: a small fixed map
  `{ claude, codex, self-hosted } → Backend` (no plugin-loader), keyed by name.
- A **selection resolver**: given a loop + the current stage (implement vs.
  review), return the backend name to use, honoring per-loop and per-stage config
  and `loopdog.yml` global defaults.
- A **subscription-auth resolver**: given a backend name + repo context, produce
  the `BackendAuth` the backend needs (Claude imported fire URL/token refs +
  repo/environment setup assertion; Codex provider repo-authorization state;
  self-hosted API-key handle) from stored credentials — never a model API key on
  the Claude/Codex path.
- Config schema additions (`@loopdog/config`) for `backends.default` and
  `backends.review`, plus validation (unknown backend, missing auth, ZDR + Claude
  conflict).
- Clear, actionable errors when a selected backend is unauthorized or unavailable.

### Technical detail

**Config surface** (validated in 0006; this task adds the keys + checks):

```yaml
# loopdog.yml (global defaults)
backends:
  default: claude               # root default execution backend for all loops
  review: codex                 # default backend for the review stage (cross-provider)
```
```yaml
# .loopdog/loops/<name>/loop.yml (per-loop override; strictest/most-specific wins)
backends:
  default: codex                # this loop implements on Codex
  review: claude                # ...and is reviewed on Claude
```

**Selection precedence** (most-specific wins): loop `backends.<stage>` → loop
`backends.default` → root `backends.<stage>` → root `backends.default` → built-in
default `claude`.
`stage` is derived from the transition kind (`review`/`verify` edges → `review`
stage; everything else → `implement` stage), supplied by the runner. The resolver
is pure and lives in `@loopdog/backends/src/selection`:

```ts
type Stage = "implement" | "review";
type BackendName = "claude" | "codex" | "self-hosted";
function selectBackend(cfg: ResolvedConfig, loop: LoopConfig, stage: Stage): BackendName;
```

**Registry** (`@loopdog/backends/src/registry`): `getBackend(name): Backend` over a
frozen map; unknown name → typed `UnknownBackendError`. No dynamic import / no
marketplace (codebase guardrail: "small fixed registry behind an interface").

**Auth resolution** (`@loopdog/backends/src/auth`) — the credential the chosen
backend authenticates with, by plane:

```ts
type ClaudeRepoAuth =
  | { kind: "provider-app"; installed: true }
  | { kind: "web-setup"; verified: true };
type BackendAuth =
  | { kind: "claude"; fireUrl: SecretRef; routineToken: SecretRef; repoAuth: ClaudeRepoAuth }
  | { kind: "codex";  providerAppInstalled: true }          // mention-only; no token loopdog holds
  | { kind: "self-hosted"; apiKey: SecretRef };             // adopter's own key
function resolveAuth(name: BackendName, ctx: RepoContext): BackendAuth;  // throws BackendAuthError
```

- **Claude**: requires the imported routine `/fire` URL and bearer token secret
  refs captured by `loopdog connect claude`, plus a recorded repo-authorization
  assertion from the operator's Claude setup (`web-setup`/connected repo, or
  provider App only if the user opts into Claude-native GitHub triggers outside
  Loopdog's primary API-fire path). Store both fire URL and token as repo secrets or
  keychain-backed `SecretRef`s and reference them, never inline them. No
  `ANTHROPIC_API_KEY`, no Claude Platform model API key. Missing import is a
  pre-flight auth error with remediation: run `loopdog connect claude --reimport`
  after creating/regenerating the routine API trigger in Claude.
- **Codex**: requires only the OpenAI App installed + repo authorized — dispatch is
  the `@codex` mention, so loopdog holds **no** provider token; `resolveAuth` just
  asserts App presence (probe via the `@loopdog/github` identity/App-installation
  read) and returns.
- **Self-hosted**: the *only* path with an API key — a `SecretRef` to the adopter's
  Actions secret / OIDC / Vault handle (M07 · 0031), resolved at dispatch by the
  self-hosted backend (0074), never logged.

`SecretRef` is an opaque pointer (env-var name or secret id), resolved lazily by
the backend, so this layer passes references and never holds plaintext.

**Validation** (`@loopdog/config` + cross-checked here): unknown backend name;
selected backend with no resolvable auth (missing provider repo authorization /
missing routine token / missing self-hosted key) → fail pre-flight with a
remediation message (e.g. "run `loopdog login` / `loopdog connect claude`");
**ZDR org + `backend: claude`** → reject with a directive to `self-hosted` (mirrors
0020's ZDR-excluded path). Capability conflicts (e.g. a loop whose gates need
live-secret tests but selects a `secret_phase: setup-only` backend) surface as a
**warning** via the backend's `capabilities()` (0019), not a hard error.

**Runner integration**: `@loopdog/runtime` calls `selectBackend` then
`resolveAuth` in the transition pre-flight, *after* gates/authorization/budget
(0012) and *before* `dispatch`; the resolved `{ backend, auth }` is recorded in
the run record's `backend` field (0012 schema) for the CLI session link (0069).
Auth resolution failure is a pre-flight failure → handed to backoff/escalation
(M12 · 0051), not a crash.

## Out Of Scope

- The backend implementations themselves (0020/0021/0074) and the interface (0019).
- Onboarding UX: Claude routine import or provider App install where applicable,
  repo authorization, the interactive picker (M02 · 0010); keyless login + token
  capture (M02 · 0077).
- Where provider-cloud secrets / self-hosted secrets physically live and are
  injected (M07 · 0030/0031); correlation/ingest (0073).
- Cross-model *routing by outcome telemetry* (M13) — this task is static,
  config-declared selection only.

## Acceptance Criteria

- [x] `selectBackend` returns the correct backend for implement vs. review under
      the full precedence chain (loop-stage → loop-default → root-stage →
      root-default → default), proven by a table test.
- [x] A loop can implement on one backend and be reviewed on another via
      `backends.review`, with no code change.
- [x] `resolveAuth` returns a `BackendAuth` carrying only references (`SecretRef`) —
      no plaintext model API key on the Claude/Codex path; self-hosted is the only
      key-bearing variant.
- [x] Claude auth resolution rejects `ANTHROPIC_API_KEY`/Claude Code GitHub Action
      configuration as satisfying subscription auth; it requires imported routine
      fire URL + bearer-token `SecretRef`s.
- [x] An unknown backend name and an unauthenticated selected backend each fail
      pre-flight with an actionable remediation message (not a stack trace).
- [x] `backend: claude` on a ZDR-flagged repo is rejected with a self-hosted
      directive.
- [x] The chosen backend name is recorded in the run record.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `backends.default` + `backends.review` to the `loopdog.yml` and `loop.yml`
      zod schemas (`@loopdog/config`) with validation.
- [x] Implement the frozen backend registry + `UnknownBackendError`
      (`@loopdog/backends/src/registry`).
- [x] Implement the pure `selectBackend` precedence resolver + stage derivation
      (`@loopdog/backends/src/selection`).
- [x] Implement `resolveAuth` per backend + `BackendAuth`/`SecretRef` types +
      `BackendAuthError` (`@loopdog/backends/src/auth`), reading provider repo-auth
      state via `@loopdog/github`.
- [x] Add the ZDR + Claude conflict check and the capability-mismatch warning.
- [x] Wire selection + auth into the runner pre-flight (`@loopdog/runtime`) ahead of
      dispatch; record the chosen backend in the run record.
- [x] Tests for selection, auth resolution, and error paths using the M18 fakes.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral cases use the `@loopdog/testing`
fakes (fake GitHub/provider-connect state, fake backends/registry) — **no real
quota, no real provider auth**.

```bash
# unit: selectBackend precedence table (loop-stage/loop/root-stage/root/default)
# unit: resolveAuth returns refs only; claude/codex hold no api key; self-hosted does
# component: unknown backend + missing-auth + ZDR-claude → actionable pre-flight errors
# scenario: implement-on-claude / review-on-codex loop selects each backend correctly
```

## Verification Log

- 2026-06-09: selection/auth suite green: the full precedence table
  (loop-stage → loop-default → root-stage → root-default → claude) per stage;
  implement-on-X / review-on-Y with no code change; resolveAuth returns refs
  only (claude/codex keyless; self-hosted carries the key NAME); the
  ANTHROPIC_API_KEY rejection; missing-import and unknown-backend errors are
  actionable; ZDR+claude rejected with the self-hosted directive (config
  validation AND auth resolution); the fixed three-backend registry.

## Decisions

- Selection precedence as specced; the pure resolver lives in `@loopdog/core`
  (config must apply it inside its dependency boundary) and is re-exported
  from `@loopdog/backends` (its spec home). Stage rule: edges leaving
  `in-review` are the review stage.
- Config keys: root `backends.{default,review,zdr,self_hosted}`; per-loop
  flat `backend:`/`review_backend:` (kept from 0006 instead of a nested
  per-loop `backends:` block — fewer shapes for the same expressiveness;
  recorded deviation).
- `BackendAuth` shapes as specced; `SecretRef` = the env/Actions secret NAME
  (LOOPDOG_CLAUDE_FIRE_URL/TOKEN; LOOPDOG_MODEL_API_KEY default) — plaintext
  resolves only inside the consuming backend/worker.
- Auth failures surface at dispatch through the runner's failure path
  (release + attempts + escalation) with remediation text in the message;
  registry construction is the controller's job (CLI stays inside its
  boundary).

## Risks / Rollback

Main risk is **leaking a credential into config or logs** — mitigated by passing
only `SecretRef` references through this layer and resolving plaintext lazily
inside each backend. A wrong selection (e.g. silently defaulting to Claude on a
ZDR repo) is caught by the validation checks above; if selection misbehaves, fall
back to the single root `backends.default` and disable per-stage overrides via
config. No provider quota is spent by this task in isolation (selection + auth
resolution are pre-dispatch).

## Final Summary

Selection + auth resolution: pure precedence selection (core) applied at
config resolution so every LoopDefinition carries its final backend; the
frozen three-backend registry built by the controller; per-backend
`resolveAuth` returning credential REFERENCES only, with actionable errors
(connect/rotate remediation, API-key rejection, ZDR directive); chosen backend
recorded on every run record.
