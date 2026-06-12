# 0030 Provider Cloud Env & Secret Config

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Let the provider's cloud work cell actually build and run the project's tests:
define how looper declares the provider sandbox **setup script + env vars** for
the Claude routine env and the Codex env, validate that each backend can satisfy
the declaration, and document — honestly — that these env vars are *not* a secret
store, that Claude routine env is configured in Claude's cloud environment rather
than injected by Looper at `/fire` time, that Codex strips secrets before the
agent phase, and that genuinely sensitive integration tests belong on the
self-hosted backend with the adopter's CI as the trustworthy gate.

## Background

Part of [Milestone 07](../milestones/milestone-07-secrets-and-identity.md) — the
**project-secret plane**: the build/test/deploy secrets the work cell needs, on
the primary path configured into the *provider's* cloud environment (setup
scripts + env vars), with the residency/trust boundary stated plainly. See
[architecture](../../docs/architecture.md) "Identity & secrets (two planes)", "The
honest constraints", and the provider snapshot (Claude: "Anthropic-provisioned
Ubuntu sandbox with setup scripts + env vars, no dedicated secrets store yet";
Codex: "setup + maintenance scripts and env vars, but secrets stripped before the
agent phase and agent-phase internet off by default"). The `SecretBackend` port
lives in `@looper/core` ([codebase](../../docs/codebase.md) — ports table); the
provider-env impls land in `@looper/backends`, the config schema in
`@looper/config`. This is the env half of the plane; secret *injection + leak
guards* for the self-hosted path are 0031, and the trust-boundary doc is 0032.

Claude caveat resolved by M00: imported Claude routines receive only the saved
routine prompt plus the freeform `/fire` `text` payload at dispatch. Their setup
script, environment variables, network access, connectors, and repo/branch
permissions are configured in Claude's web UI as part of the routine/cloud
environment. Looper tracks the required names and validates/document the setup; it
does not forward GitHub Actions secrets into Claude on each fire.

## Scope

- A `looper.yml` config block declaring the work-cell environment: a `setup`
  command/script reference + a typed `env` map, with per-backend overrides.
- A `SecretBackend`/provider-env resolver that renders that declaration into the
  shape each backend needs, with backend-specific modes:
  - Claude routine: declaration/doctor checklist only; user configures values in
    Claude's cloud environment.
  - Codex: setup/env shape consumed by the Codex backend, with setup-only secret
    caveats.
  - Self-hosted: real secret injection via 0031.
- Value sourcing: literal, `from_env` (read at controller render time from the
  Actions job env / repo variables), `from_actions_secret:` (an Actions secret the
  controller exposes in its own job where a backend can consume it), and
  `provider_configured:` (value must be configured in the provider cloud UI, used
  for Claude routines). Never a hosted store.
- A **classification flag** per env entry (`sensitivity: build | runtime |
  sensitive`) that drives validation: `sensitive` entries against a provider
  backend produce a warning routing them to self-hosted (0031).
- Codex-specific handling: emit setup-script env *and* mark which vars survive
  only to the setup phase (stripped before agent phase), feeding the 0021
  capability-mismatch check.

### Technical detail

**Config (lands in `@looper/config`, schema validated with `zod`).** A root
`looper.yml` `work_cell.env` block, overridable per loop in
`.looper/loops/<name>/loop.yml`:

```yaml
work_cell:
  setup: ".looper/setup.sh"          # expected setup script / provider setup reference
  env:
    NODE_ENV:        { value: "test", sensitivity: build }
    DATABASE_URL:    { from_env: "TEST_DATABASE_URL", sensitivity: runtime }
    STRIPE_TEST_KEY: { from_actions_secret: "STRIPE_TEST_KEY", sensitivity: sensitive }
  backends:
    claude:
      env:
        DATABASE_URL: { provider_configured: true, sensitivity: runtime }
      setup: "configured in Claude cloud environment"
    codex:  { setup: ".looper/setup.codex.sh" }   # backend-specific override
```

`sensitivity` ∈ `build` (no secret, e.g. `NODE_ENV`), `runtime` (a credential the
test needs but is low-blast-radius / test-scoped), `sensitive` (production-grade
secret that must not reside in provider cloud). Each value is one of: `value`
(literal), `from_env` (read from the controller's job env at render time where the
selected backend supports runtime forwarding), `from_actions_secret` (read from a
secret the controller's Actions job maps in where supported), or
`provider_configured` (the provider environment must already contain it).

**Resolver (lands in `@looper/backends`, a `ProviderEnvResolver` keyed off the
`SecretBackend` port in `@looper/core`).** `resolve(workCellEnv, backend) ->
ResolvedEnv { setup: string, env: Record<string,string>, dropped: string[] }`:

1. Classify each entry by selected backend. For Claude routines, entries must be
   literal prompt-safe values or `provider_configured`; `from_env` /
   `from_actions_secret` values are **not** forwarded at `/fire` time and produce
   a doctor error unless they are marked CI-only or self-hosted.
2. For backends that support runtime forwarding, read each entry's value from its
   source (literal / `process.env` / mapped Actions secret) at controller render
   time — looper never holds a long-lived model API key; these are *project*
   secrets the controller forwards once.
3. Apply the backend's `extra_env` / `setup` override.
4. For Codex (`secret_phase: setup-only`, 0021), record which entries are
   available only at setup (`dropped` = the ones the agent phase won't see) so the
   brief and validation can warn that agent-phase tests can't use them.
5. Return the env result the backend can actually use: Claude → required
   provider-configured names + setup checklist; Codex → env + setup-script content
   the `@codex` flow expects (0021); self-hosted → delegate to 0031's injected
   store.

**Validation (wired into `looper loops validate` / `doctor`, M16).**
- Any `sensitivity: sensitive` entry resolved against a provider backend → a
  warning: "STRIPE_TEST_KEY is provider-resident and (Codex) stripped before the
  agent phase; route this test to the self-hosted backend (0031) or keep it
  CI-only." Reuses 0021 `checkCompatibility` for the Codex network/secret-phase
  case.
- Any Claude routine loop using `from_env` / `from_actions_secret` for a value the
  work cell needs → fail doctor with "configure this in the Claude cloud
  environment, keep it CI-only, or switch this loop to self-hosted." Looper does
  not copy GitHub Actions secrets into Claude at `/fire` time.
- A referenced `from_actions_secret`/`from_env` that is unset at render → fail
  loud before dispatch for forwarding-capable backends (don't ship a
  half-configured sandbox that fails opaquely).

**Honest constraints, documented inline + handed to 0032.** Provider env vars are
visible to anyone who can edit the provider environment (no dedicated secret store
yet), Claude routine env is user-configured in Claude's cloud environment, and
Codex strips secrets before the agent phase; so the *trustworthy* test gate is
always the adopter's CI (ladder rung 2), which runs regardless of where the work
cell ran. The provider sandbox is for *producing* the change and best-effort
self-test, not for trusting it.

**Edge cases:** empty `env` (setup-only loops) is valid; a per-loop override fully
replaces (not merges) the named key; a `from_actions_secret` the controller's job
didn't map resolves to unset → fail-loud for forwarding-capable backends; Claude
`provider_configured` and Codex `setup` overrides coexist without leaking each
other's keys across backends.

## Out Of Scope

- Self-hosted secret injection + leak/scrubbing guards (0031).
- The standalone trust-boundary doc (0032) — this task feeds it the residency
  facts but doesn't write the doc.
- The `SecretBackend` port definition itself (core; 0029-area) and provider auth
  plane / `looper login` (0029).
- Brief composition (0022) and the backend dispatch internals (0020/0021) beyond
  the env-shaping handoff.

## Acceptance Criteria

- [x] `work_cell.env` (+ `setup`, per-backend overrides) is a validated
      `@looper/config` schema with `value` / `from_env` / `from_actions_secret` /
      `provider_configured` sources and a `sensitivity` flag.
- [x] The `ProviderEnvResolver` renders or validates that declaration according to
      backend capability: Claude routine doctor checklist, Codex env/setup shape,
      self-hosted secret injection handoff.
- [x] For Codex, the resolver reports which env entries are setup-only (stripped
      before the agent phase) as `dropped`.
- [x] A `sensitivity: sensitive` entry against a provider backend raises a
      validate/doctor warning routing it to self-hosted (0031), and an unset
      `from_env`/`from_actions_secret` reference fails loud before dispatch.
- [x] A Claude routine loop cannot claim that GitHub Actions secrets are forwarded
      into Claude at `/fire` time; required values must be `provider_configured`,
      CI-only, or self-hosted.
- [x] No long-lived model API key is stored on this path; values are forwarded
      from the controller's own Actions job, not a hosted store.
- [x] Docs/onboarding state the provider-residency + Codex-stripping caveat and
      name the adopter's CI as the trustworthy gate.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `work_cell.env`/`setup`/`backends.*` schema + validation in
      `@looper/config`.
- [x] Implement `ProviderEnvResolver` in `@looper/backends` over the `core`
      `SecretBackend` port; wire Claude to doctor/checklist validation, Codex to
      dispatch shaping, and self-hosted to 0031.
- [x] Implement value sourcing (literal / `from_env` / `from_actions_secret`) at
      controller render time only for backends that support forwarding; implement
      `provider_configured` validation for Claude routines.
- [x] Implement the `sensitivity` classification + Codex setup-only `dropped`
      reporting, reusing 0021 `checkCompatibility`.
- [x] Wire the `sensitive`-against-provider warning + unset-reference fail-loud
      into `looper loops validate` / `doctor`.
- [x] Document the residency/stripping caveat (feed 0032) and the adopter-CI gate.

## Test Plan

Tests run via the repo's vitest runner; all provider interaction goes through the
M18 fakes (in-memory GitHub + fake Claude/Codex backends) — no real quota or
secrets consumed.

```bash
# unit: config schema accepts/rejects env entries; sources resolve from a stubbed
#       process.env / mapped-secret map; unset reference -> fail loud
# unit: resolver rejects Claude from_actions_secret forwarding, accepts
#       provider_configured names, and renders Codex (env+setup, dropped[]) shapes;
#       per-loop override replaces a key; backend config doesn't cross-leak
# component: a `sensitivity: sensitive` env against the fake Codex backend yields a
#       validate warning routing to self-hosted; a build-only env passes clean
```

## Verification Log

- 2026-06-09: provider-env suite green: Claude renders NOTHING at dispatch
  (drops + provider checklist instead, honoring the M00 no-forwarding
  decision); Codex renders values but marks every one setup-only (stripped
  before the agent phase — feeds the 0021 mismatch check); self-hosted gets
  full injection; `sensitive` entries against provider backends warn with the
  self-hosted directive; missing sources drop with reasons.

## Decisions

- Config: root `work_cell.{setup,env,backends}` with per-entry source
  (value/from_env/from_actions_secret/provider_configured — exactly one,
  zod-refined) + `sensitivity: build|runtime|sensitive`.
- Claude mode is declaration/doctor-checklist ONLY: every non-provider_configured
  entry is dropped with guidance, and everything lands on the providerChecklist
  the connect/doctor flows print. No value ever crosses to Claude at /fire.
- Codex mode renders into setup and reports `setupOnly` for all values.
- Resolver lives in `backends/work-cell/` (resolveWorkCellEnv), pure over the
  controller env.

## Risks / Rollback

- **False sense of secrecy.** Provider env vars are not a secret store and Codex
  strips them before the agent phase — if adopters treat them as a vault, prod
  secrets leak into provider infra. Mitigation: the `sensitivity: sensitive`
  warning, the fail-loud unset check, and the explicit "adopter CI is the
  trustworthy gate" framing routing real secrets to self-hosted (0031).
- Rollback: a loop can ship with an empty `work_cell.env` (setup-only / public
  tests) and rely entirely on the adopter's CI gate — no schema change needed to
  back out provider-resident secrets.

## Final Summary

The work-cell env declaration + per-backend resolver: honest about what each
backend can receive (Claude: web-UI checklist only; Codex: setup-only; self-
hosted: real injection), with sensitivity classification routing
production-grade secrets away from provider clouds.
