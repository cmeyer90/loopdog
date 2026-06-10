# 0074 Self-Hosted / API Backend (secondary)

Status: planned  
Branch: task/0074-self-hosted-api-backend

## Goal

Implement the execution-backend interface (0019) for a **self-hosted** work cell:
the adopter runs the agent on **their own compute** (a GitHub Actions job or a
container/host they control) using **their own model API key** (Anthropic API /
Bedrock / Vertex, or OpenAI via `codex exec`). This is the confirmed secondary
backend that recovers exactly what the provider-cloud path gives up — full
live-secret + network access during the work cell, no provider rate caps, and
Zero-Data-Retention (ZDR) compatibility — for the three cases the subscription
path cannot serve (ZDR orgs, no subscription, tests needing live secrets/network).

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md);
implements the one `dispatch(brief) → ingest(result)` contract (0019) alongside
Claude (0020) and Codex (0021). This is the **only** backend that holds a model
API key, and the **only** one whose work cell runs on the adopter's compute rather
than the provider's cloud — so it is also the only path with a direct model API
call (deliberately off the primary path; see the constraint). See
[architecture](../../docs/architecture.md) "Self-hosted / API backend (secondary)"
and "Identity & secrets (two planes)" — and [codebase](../../docs/codebase.md):
this lands in `@looper/backends` (`backends/src/self-hosted/`), implementing the
`Backend` port in `@looper/core`. Correlation/ingest is the shared primitive
(0073); the runner that calls it is the transition runner (M03 · 0012); selection
+ the API-key `SecretRef` are resolved upstream (0023). Decision-of-record:
support both backends, subscription-cloud is the default, this is first-class but
never the happy path (architecture, 2026-06-08).

## Scope

- A `SelfHostedBackend` implementing the 0019 `Backend` interface.
- **Full-capability** metadata (`secret_phase: full`, `network: on`, no provider
  rate cap) so the runner stops routing secret/network gates away.
- Dispatch as **adopter-side execution**: trigger a dedicated, adopter-owned
  worker workflow (`looper-self-hosted-worker`) that runs the agent CLI in the
  adopter's runner/container with their API key, branches per the run, and opens a
  PR — versus the provider-cloud async-mention model.
- Ingest the resulting PR via the shared 0073 correlation (same branch/trailer/
  issue-ref scheme — providers are interchangeable to the ingest path).
- The runner shape: which agent CLI to invoke (`claude`/`codex exec`), how the
  model API key is read (lazily, from a `SecretRef`) and scrubbed from logs.
- Onboarding artifact: a `templates/workflows/looper-self-hosted-worker.yml` the
  adopter installs once.

### Technical detail

**Capabilities** (consumed by the runner 0012, budget/quota M12 · 0075, and the
capability-mismatch check 0021):

```
capabilities() -> {
  trigger_modes: [self_hosted_dispatch],   # workflow_dispatch / repository_dispatch — NOT provider api_fire/mention
  runs_sandbox: true,            # the adopter's own runner/container is the sandbox
  secret_phase: full,            # live secrets present the WHOLE run (recovered)
  network: on,                   # full network during the work cell (recovered)
  opens_pr: true, supports_review: true,
  zdr_compatible: true,          # the differentiator: nothing leaves adopter compute
  throughput: { tasks_per_hour: null }   # no provider cap; bounded only by resilience max_in_flight (M19)
}
```

This is the inverse of Codex's restricted shape (0021): `full`/`on`/`null` cap.
It is what makes a secret-/network-dependent gate that 0021 flags a *mismatch*
against Codex pass cleanly here — `checkCompatibility` (0021) is the same function,
and self-hosted is the directive's destination.

**Auth**: a single model API key, provided as a `SecretRef` resolved by 0023
(`BackendAuth { kind: "self-hosted"; apiKey: SecretRef }`). The `SecretRef` is an
opaque pointer (Actions secret name / OIDC / Vault handle, M07 · 0031) — this
backend resolves it to plaintext **lazily, only inside the worker job**, exports it
as the agent CLI's env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), and never
logs it. The controller dispatching the worker still acts as the `GITHUB_TOKEN`
(M01) — only the work cell sees the key, and only in the adopter's own job.

**Dispatch** (`dispatch(brief, context) -> DispatchHandle`): because the work cell
is adopter-owned, dispatch starts an **adopter-side worker run** rather than
poking a provider. Concretely: trigger the `looper-self-hosted-worker` workflow via
the GitHub port (`workflow_dispatch`/`repository_dispatch`) with inputs
`{ run_id, loop, issue, brief_ref, agent: claude|codex, api_key_secret }`. The
worker job: checks out the repo, resolves the API-key `SecretRef`, runs the chosen
agent CLI non-interactively against the composed brief (`claude -p` headless /
`codex exec`), then **branches `looper/<loop>/<issue>-<run_id>`, includes the
`looper-run: <run_id>` PR trailer, references `#<issue>`, and opens the PR** — the
identical correlation contract every backend produces (0073), so ingest is
provider-agnostic. The `DispatchHandle` carries the `run_id`, the dispatched
workflow-run id (the CLI `runs show` session link, 0069), and the expected branch.
A self-hosted dispatch that does its model call inside the adopter's job is the
**one place a model API call happens** — kept off the primary/subscription path by
design and only reached when a loop explicitly selects `backend: self-hosted`.

**Ingest** (`ingest(github_event) -> IngestResult | null`): identical to the other
backends — delegate to the 0073 matcher (branch → trailer → issue-ref) on
`pull_request` / `check_suite` / `workflow_run` events; a matched PR returns
`{ pr, status }`, an unrelated event returns `null`. Idempotency and the
no-result/timeout path are owned by 0073 + the cron sweep (0076): a worker run that
fails or yields no PR within the lease is escalated by the sweep, never stranded.
(The `workflow_run` failure event is also surfaced so a crashed adopter job
escalates promptly rather than waiting for the lease.)

**Agent-CLI runner** (`backends/src/self-hosted/runner.ts`): a thin, isolated
adapter over the two agent CLIs — a `run(agent, brief, repoDir, env) -> {branch,
pr}` boundary — so adding/swapping a CLI is a one-module change (no
`@anthropic-ai`/OpenAI client SDK pulled into `core`/`runtime`; the key and the
model call stay in the worker). Exit-non-zero → reported failure, not a silent
no-PR.

**Worker template** (`templates/workflows/looper-self-hosted-worker.yml`):
`workflow_dispatch`-triggered, references `secrets.LOOPER_MODEL_API_KEY`
(adopter-named via config), and is the adopter's one-time install — documented as
"the escape hatch for ZDR / no-subscription / live-secret tests." `looper init`
scaffolds it only when a self-hosted backend is configured.

**Edge cases**: missing/unresolvable API-key secret → fail pre-flight with a
remediation message (0023 surfaces `BackendAuthError`); the worker workflow not
installed → actionable error at validate/doctor time; a `repository_dispatch` that
`GITHUB_TOKEN` won't re-trigger is the same controller→controller handoff the cron
sweep (0076) carries — no App required (use the dispatch-event the adopter's repo
allows, or fall back to the sweep). ZDR repos that selected `backend: claude` are
rejected with a directive *to this backend* (0020/0023).

## Out Of Scope

- The interface/capability schema (0019); brief composition + prompt/policy
  artifacts (0022).
- Backend selection + the API-key `SecretRef` resolution (0023); where the
  self-hosted secret physically lives / injection (M07 · 0031).
- Correlation/ingest mechanics + the sweep timeout themselves (0073/0076).
- The Claude (0020) and Codex (0021) subscription backends.
- Cross-model routing by outcome telemetry (M13).

## Acceptance Criteria

- [ ] `SelfHostedBackend` conforms to the 0019 interface with capabilities exactly
      `secret_phase: full`, `network: on`, `zdr_compatible: true`,
      `throughput.tasks_per_hour: null`, `trigger_modes: [self_hosted_dispatch]`.
- [ ] `dispatch` triggers the adopter-owned worker workflow via the GitHub port
      with the run inputs, resolving the model API key only as a `SecretRef`
      (lazily, inside the worker) and never logging it.
- [ ] The worker produces a PR on branch `looper/<loop>/<issue>-<run_id>` with the
      `looper-run: <run_id>` trailer and `#<issue>` ref, so `ingest` correlates it
      via 0073 exactly like the subscription backends; unrelated events → `null`.
- [ ] A gate requiring live secrets / agent-phase network — a mismatch against
      Codex (0021) — passes against this backend (no mismatch flagged).
- [ ] A failed/crashed worker run (non-zero exit or no PR within the lease) is
      reported and escalated via 0073/0076, not stranded.
- [ ] `looper init` scaffolds `looper-self-hosted-worker.yml` only when a
      self-hosted backend is configured; a missing worker workflow is an actionable
      validate/doctor error.
- [ ] `self-hosted` is registered in the backend registry (0023) and selectable
      per loop/stage with no schema change.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Implement `SelfHostedBackend.capabilities()` with the full-capability shape.
- [ ] Implement `dispatch` triggering the worker workflow over the GitHub port,
      passing `run_id`/`loop`/`issue`/`brief_ref`/`agent`/`api_key_secret`.
- [ ] Implement the agent-CLI runner boundary (`claude -p` / `codex exec`) with
      lazy `SecretRef` resolution + log scrubbing.
- [ ] Implement `ingest` delegating to the 0073 matcher + the `null` / failure /
      `workflow_run`-failure paths.
- [ ] Add `templates/workflows/looper-self-hosted-worker.yml` + wire `looper init`
      to scaffold it when configured.
- [ ] Register `self-hosted` in the backend registry; add a fake self-hosted
      backend + worker simulation to `@looper/testing`.

## Test Plan

Tests run via the repo's `vitest` runner; all provider/agent interaction goes
through the M18 fakes (in-memory GitHub + a fake self-hosted backend that simulates
the worker opening a correlated PR) — **no real API key, no real quota, no real
model call**.

```bash
# unit: capabilities() returns the full shape (secret_phase:full, network:on,
#       tasks_per_hour:null, zdr_compatible:true)
# unit: checkCompatibility (0021) flags NO mismatch for a secret/network gate here
# component: dispatch triggers the worker workflow via fake-github with run inputs;
#       assert the api key is passed only as a SecretRef and never appears in logs
# component: simulate the worker's PR (branch+trailer+issue ref) → ingest correlates
#       once via 0073; an unrelated PR → ingest returns null
# component: a non-zero worker exit / no-PR-within-lease → escalation, not stranded
# scenario: a ZDR-flagged loop selects self-hosted and runs implement → review
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the worker-dispatch mechanism chosen (`workflow_dispatch` vs.
`repository_dispatch`), the worker-input shape, the agent-CLI invocation strings
(`claude -p` / `codex exec`), how the API-key `SecretRef` is resolved + scrubbed,
and the exact capability values (esp. `zdr_compatible` + null cap).

## Risks / Rollback

- This backend **holds a model API key and makes the only direct model call** —
  the one place per-token billing and key custody exist. Keep it strictly opt-in
  (selected via 0023), resolve the key lazily inside the worker only, and scrub it
  from all logs; a leak here is the highest-severity failure in the plan.
- The work cell runs on **adopter compute**, so its reliability/security is the
  adopter's, not the provider's — document the boundary plainly (it is the inverse
  of the provider-cloud trust boundary).
- Agent CLI flags (`claude -p`, `codex exec`) may drift; isolate them in the runner
  module so a change is a one-file fix, and fail loud on non-zero exit.
- Rollback: disable `self-hosted` in the registry / loop config; loops fall back to
  Claude (0020) or Codex (0021) with no schema change (ZDR/no-subscription repos
  lose execution until re-enabled — documented).

## Final Summary

Fill this in before marking verified.
