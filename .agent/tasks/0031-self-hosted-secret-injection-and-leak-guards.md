# 0031 Self-Hosted Secret Injection & Leak Guards

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Give the self-hosted/API backend a pluggable `SecretBackend` port that injects the
adopter's own project secrets (Actions secrets / OIDC / Vault / Doppler) into the
adopter-controlled work-cell container, plus leak guards (output scrubbing +
preflight redaction) so no secret value ever lands in model-visible context or in
anything looper writes back to GitHub.

## Background

Part of [Milestone 07](../milestones/milestone-07-secrets-and-identity.md) — the
self-hosted leg of the two-plane secret model. The primary path keeps secrets in
the provider's cloud (0030) and never lets looper hold them; the self-hosted
backend (0074) deliberately **recovers full secret + network access** during the
work cell by running on the adopter's own compute — which means looper now handles
real secret material and must guard it. See [architecture](../../docs/architecture.md)
"Identity & secrets (two planes)" (project-secret plane) and "Self-hosted / API
backend." The rule we must not break: looper never serializes a long-lived
credential into prompts, plans, run records, comments, logs, or other
model/GitHub-visible artifacts it controls; self-hosted env-injected values are
scrubbed before egress. Lands mainly in `@looper/backends`
(`self-hosted/`), with the `SecretBackend` port + scrubber interface declared in
`@looper/core/ports`.

## Scope

- A `SecretBackend` port (in `core`) and provider impls in `backends/self-hosted/`
  resolving secrets from the adopter's chosen store at dispatch time.
- Injection of resolved secrets into the self-hosted container env (never into the
  brief, prompt, or any GitHub-visible artifact).
- Leak guards: a scrubber that redacts known secret values + high-entropy/token
  patterns from work-cell logs, PR/comment text, run records, and CLI output.
- Capability wiring: the self-hosted backend reports `secret_phase: full`,
  `network: on` so the runner (0012) and CI ladder know live-secret tests can run.

### Technical detail

**`SecretBackend` port (`@looper/core/ports/secret-backend.ts`):**

```
SecretBackend:
  resolve(refs: SecretRef[], ctx: RunContext) -> Map<name, SecretValue>  # at dispatch
  registerScrubTargets(values: SecretValue[]) -> void   # feed the leak guard
SecretRef  = { name: string, from: 'actions'|'oidc'|'vault'|'doppler', key?: string }
SecretValue = { name, value, source }   # value never serialized to plan/run-record
```

Config: a repo-wide + per-loop `secrets:` block in `loop.yml` / `.looper/config`
listing the **names + source** the work cell needs (never values). Example:

```yaml
secrets:
  store: vault            # actions | oidc | vault | doppler  (self-hosted only)
  inject:
    - { name: DATABASE_URL, key: ci/db/url }
    - { name: NPM_TOKEN,    from: actions }
```

**Resolution + injection (in `backends/self-hosted/`):** at `dispatch`, before the
agent phase, the backend (a) calls `SecretBackend.resolve` against the configured
store, (b) writes the resolved values **only** into the container's env / a
tmpfs-mounted env-file (mode 0600, deleted on exit), and (c) calls
`registerScrubTargets` so every resolved value is added to the scrubber's
deny-list. Store impls: `actions` (read `process.env` injected by the adopter's
workflow `env:`/`secrets:`), `oidc` (exchange the workflow OIDC token for a
short-lived cloud cred), `vault`/`doppler` (token-or-OIDC auth, fetch by key). All
network calls happen in looper's **deterministic** code, not the model phase.

**Leak guard / scrubber (`backends/self-hosted/scrubber.ts`, interface in `core`):**
- **Value redaction:** replace every registered secret value (and common
  encodings — base64, URL-encoded, JSON-string-escaped) with `«redacted:NAME»`.
- **Pattern redaction:** a fixed pattern set (AWS keys, GitHub PATs `gh[pous]_…`,
  bearer/JWT, `xox[baprs]-…`, PEM private-key blocks, `password=`/`token=` query
  params, ≥20-char high-entropy tokens) catches secrets that weren't pre-registered.
- **Choke points:** the scrubber runs on the egress path of everything model- or
  GitHub-facing — the ingested PR/comment body, work-cell logs surfaced to the
  operator, run-record `steps[].detail` (0012), and CLI `runs`/`tail` output. The
  brief/prompt is never given secret values in the first place (defense in depth).
- **Fail-closed:** if a secret value cannot be resolved, dispatch records
  `status: failed` and hands to backoff/escalation (M12 · 0051) rather than running
  the work cell without it; if the scrubber throws, the artifact is withheld, not
  emitted raw.

**Trust boundary:** secrets reside only in the adopter's runner/container and the
adopter's store — never in looper's GitHub-visible state, never in the provider
cloud. This task implements the self-hosted half; the cross-backend residency table
is documented in 0032.

## Out Of Scope

- The self-hosted backend's dispatch/ingest mechanics (0074) and the backend
  interface itself (0019) — this task adds only the secret/scrub concerns.
- Provider-cloud sandbox secret config (0030); repo identity / provider auth (0029).
- The trust-boundary documentation (0032) — referenced, written there.
- Any secret handling on the Claude/Codex primary path (those never give looper the
  values; `secret_phase: setup-only|none`).

## Acceptance Criteria

- [x] A `SecretBackend` port exists in `core` with `actions`/`oidc`/`vault`/`doppler`
      impls in `backends/self-hosted/`, selected by the `secrets.store` config.
- [x] Resolved secrets are injected into the work-cell container env only and are
      never present in the brief, prompt, plan, run record, or any GitHub write.
- [x] The scrubber redacts both registered values (incl. base64/URL/JSON encodings)
      and pattern-matched tokens on every model/GitHub-facing egress path.
- [x] An unresolved secret fails the dispatch closed (escalates), and a scrubber
      error withholds rather than emits the artifact.
- [x] The self-hosted backend reports `secret_phase: full`, `network: on` so the
      runner knows live-secret tests are available on this path.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Declare the `SecretBackend` port + `SecretRef`/`SecretValue` types in `core`.
- [x] Add the `secrets:` config block to the config schema (`@looper/config`).
- [x] Implement the four store resolvers in `backends/self-hosted/`.
- [x] Implement container env injection (tmpfs env-file, 0600, deleted on exit).
- [x] Implement the scrubber (value + pattern + encoding redaction) and wire it to
      ingest, run-record, log, and CLI egress choke points.
- [x] Wire fail-closed on unresolved-secret and scrubber-error paths.
- [x] Set the self-hosted capability flags (`secret_phase`/`network`).
- [x] Update self-hosted onboarding docs with the `secrets:` config example.

## Test Plan

Tests run via the chosen vitest runner using the M18 fakes (a fake `SecretBackend`
and in-memory GitHub — no real secret store, no real quota):

```bash
# replace with the chosen stack's runner
# resolve+inject → secret present in container env, absent from brief/plan/run-record
# scrub: registered value + its base64/URL form + a gh PAT pattern all redacted in
#        PR body, logs, run-record detail, and CLI output
# unresolved secret → dispatch fails closed + escalates (no work-cell run)
# scrubber throws → artifact withheld, not emitted raw
# capabilities() reports secret_phase: full, network: on
```

## Verification Log

- 2026-06-09: secrets suite green: actions store resolves from worker env and
  FAILS CLOSED on missing; vault store fetches by key with the token header;
  doppler store by name; oidc gives exchange guidance instead of pretending;
  scrubber redacts registered values + base64/URL/JSON encodings and
  pattern-matched tokens (PATs/AWS/anthropic/openai/slack/JWT/PEM/query
  params), and withholds the artifact on scrubber failure.
- 2026-06-09: egress wiring: TelemetryBranchStore accepts the scrub function
  (run records are GitHub-visible); the worker template resolves the key only
  inside the job env and never echoes it.

## Decisions

- Port simplification recorded: the store interface is
  `SecretStore.resolve(refs) -> ResolvedSecret[]` + the standalone `Scrubber`
  (registerScrubTargets/scrub/scrubOrWithhold) rather than a combined port —
  the scrubber is useful on paths with no store at all. Core keeps the
  original SecretBackend port + pure scrubSecrets for port-level consumers.
- Stores: actions (worker env), vault (KV-v2 fetch), doppler (API fetch),
  oidc = explicit guidance to run the cloud's exchange action then read via
  actions (looper performs no cloud-specific exchanges).
- Redaction token: `«redacted:NAME»`; query-param pattern preserves the
  param prefix for debuggability.
- Fail-closed everywhere: unresolvable secret → dispatch fails (never runs
  the work cell without it); scrubber error → artifact withheld.

## Risks / Rollback

The core risk is a leaked credential: a missed encoding or a new token shape slips a
secret into a PR body or run record that looper has already written to GitHub. Mitigate
with (a) never putting values in model-visible context at all, (b) value-based redaction
ahead of pattern-based as defense in depth, (c) fail-closed/withhold semantics, and
(d) a broad scrubber corpus test. The self-hosted backend is secondary, so this can ship
behind the `self-hosted` backend selector and be disabled by reverting to a provider
backend without affecting the primary path.

## Final Summary

Self-hosted secret injection with four store kinds and a fail-closed
contract, plus the leak-guard Scrubber (value+encoding+pattern redaction)
wired into the run-record egress path and available to every GitHub-facing
writer. Secrets live only in the adopter's runner and store.
