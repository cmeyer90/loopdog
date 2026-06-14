# 0029 Repo Identity & Provider Auth

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Establish loopdog's **repo identity** as the Actions `GITHUB_TOKEN` (least-privilege,
zero-setup) and define the **two-plane auth model** around it: handoffs the token
can't re-trigger fall back to the cron sweep (0076), an optional PAT buys instant
handoff, local CLI auth is device-flow/`gh`, and provider (work-cell) auth uses
the provider's validated subscription surface (Claude routine import; Codex
provider App). No loopdog GitHub App, no manual PAT required, no model API key on
the primary path.

## Background

Part of [Milestone 07](../milestones/milestone-07-secrets-and-identity.md) — the
identity half of the two-plane secret model; the secret planes themselves land in
0030 (provider cloud env) and 0031 (self-hosted injection), and the honest
trust-boundary writeup in 0032. This task is the foundation those build on: it
fixes *who loopdog acts as* and *what that identity may do*. See
[architecture](../../docs/architecture.md) "Identity & secrets (two planes)" and
"The `GITHUB_TOKEN` mechanic (why the sweep is load-bearing)." It lands primarily
in `@loopdog/github` (the `identity/` module: token source resolution + the
`Identity` port impl) with the permission manifest shipped from
`@loopdog/runtime` (`templates/workflows/loopdog-*.yml`); the `core` `GitHubPort`
interface already names identity. It is upstream of the runner (0012) which reads
identity to attribute claims/run-records, the sweep (0076) which is the handoff
backstop, the authorization gate (M17 · 0079) which treats `GITHUB_TOKEN` actors
as the trusted "system" actor, and backend selection (M05 · 0023) which resolves
*provider* auth (this task only resolves *repo* auth).

## Scope

- Resolve loopdog's repo identity from the runtime environment: prefer an explicit
  PAT (`LOOPDOG_PAT`) when present, else the Actions `GITHUB_TOKEN`, else (local
  CLI) the device-flow/`gh` token from 0077. Expose it through one `Identity` impl.
- Ship the **least-privilege permission manifest** for the reusable workflows.
- Implement the **fork-PR read-only caveat**: detect when the event token is
  read-only (fork-originated `pull_request`) and route any write back through the
  sweep instead of failing.
- Define (as types + docs, not new network calls) the **provider auth plane** vs
  **repo identity** split so siblings (0023/0030) attach to a stable shape.
- Document the handoff matrix: which transitions re-trigger, which need the sweep,
  what the optional PAT changes.

### Technical detail

**Identity resolution** (`@loopdog/github/src/identity/`). One port, implementing the
`core` `GitHubPort` identity surface:

```ts
type TokenSource = 'pat' | 'actions' | 'cli-device' | 'cli-gh';
interface RepoIdentity {
  token: string;             // never logged; redacted in run-records
  source: TokenSource;
  login: string;             // resolved via GET /user or actor context
  isBot: boolean;            // true for GITHUB_TOKEN ("github-actions[bot]")
  writable: boolean;         // false on fork-PR GITHUB_TOKEN (read-only)
  reTriggersWorkflows: boolean; // false for 'actions', true for 'pat'/human
}
resolveRepoIdentity(env): RepoIdentity   // pure resolution from env + event ctx
```

Resolution order: `LOOPDOG_PAT` env (instant handoff) → `GITHUB_TOKEN` (default CI)
→ CLI stored token (0077). `reTriggersWorkflows` is `false` exactly when
`source==='actions'` — this is the flag the runner/sweep consult to decide whether
a state change will be picked up by a follow-on event or must wait for the sweep
(0076). It does **not** depend on PAT type beyond presence.

**Least-privilege permissions** — the manifest baked into
`templates/workflows/loopdog-*.yml` (no repo-wide write):

```yaml
permissions:
  contents: write        # branches/commits for deterministic steps
  issues: write          # labels = state, claim comments
  pull-requests: write   # ingest/label/comment on PRs
  checks: read           # read CI verdicts for the gate
  # NOT granted: actions, packages, deployments, id-token, security-events
```

Deploy/OIDC-needing loops opt into `id-token: write` per-workflow, not by default.

**Fork-PR read-only caveat** (the load-bearing edge case). For a `pull_request`
from a fork, `GITHUB_TOKEN` is **read-only**, so any write-back (label flip, claim,
ingest comment) silently no-ops or 403s. Behavior: `resolveRepoIdentity` sets
`writable:false` (detected via the event payload — `head.repo.fork === true` and
no PAT); the runner (0012), before any write, checks `identity.writable` and on
`false` **defers the transition to the sweep** (records `deferred:fork-readonly`
in the run-record rather than `failed`) — the next scheduled sweep runs in the base
repo's privileged context and completes the write. A PAT (if set) makes fork-PR
writes work instantly and skips the defer.

**Two planes, kept distinct** (types only — no new auth network calls here):
- *Repo identity plane* — this task; `RepoIdentity` above; how loopdog reads/writes
  GitHub.
- *Provider auth plane* — the user's subscription via the provider's validated
  surface: Claude routine import (`/fire` URL + bearer-token secret refs) or Codex
  provider App; *resolved* by 0023, *onboarded* by 0010/0077. This task only
  declares the boundary so the work cell's credentials never flow through
  `RepoIdentity` and vice-versa.

**Handoff matrix** (documented + asserted in a table test): controller→controller
edge under `GITHUB_TOKEN` ⇒ no re-trigger ⇒ sweep carries it; human/PAT edge ⇒
re-triggers ⇒ instant; cron is always the trusted system actor.

## Out Of Scope

- The CLI `loopdog login` device-flow plumbing + token storage (M02 · 0077) — this
  task *consumes* its resolved token, doesn't implement it.
- Provider backend selection + provider-credential resolution (M05 · 0023);
  provider onboarding UX (Claude routine import; Codex App install) (M02 · 0010).
- The project-secret planes: provider cloud env (0030), self-hosted injection +
  leak guards (0031), and the trust-boundary doc (0032).
- Any loopdog GitHub App, hosted backend, or model API key on the primary path.

## Acceptance Criteria

- [x] `resolveRepoIdentity` returns the right `source`/`token` for each of: PAT set,
      Actions default, CLI-stored — with PAT taking precedence.
- [x] `reTriggersWorkflows` is `false` only for `source==='actions'`; the handoff
      matrix table test passes for every controller/human/cron edge.
- [x] A fork-originated `pull_request` yields `writable:false`, and the runner
      defers (not fails) write-backs to the sweep, recording `deferred:fork-readonly`.
- [x] A PAT makes the same fork-PR write-back proceed instantly (no defer).
- [x] The reusable-workflow templates declare the least-privilege `permissions`
      block above; no `actions`/`deployments`/`security-events` write by default.
- [x] The token is never present in any run-record, log line, or telemetry payload
      (redaction test).
- [x] No loopdog GitHub App, no model API key, and no DB/queue introduced.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `@loopdog/github/src/identity/` with `resolveRepoIdentity` + the
      `RepoIdentity` type, wired into the `GitHubPort` impl.
- [x] Implement source precedence (`LOOPDOG_PAT` → `GITHUB_TOKEN` → CLI) and the
      `reTriggersWorkflows`/`writable` flags from env + event context.
- [x] Add fork-PR detection + the runner defer-to-sweep path (coordinate the
      `deferred:fork-readonly` outcome with 0012/0076).
- [x] Set the least-privilege `permissions` manifest in
      `templates/workflows/loopdog-*.yml`; document the opt-in `id-token` for deploy.
- [x] Add token redaction to the run-record/telemetry serializer.
- [x] Document the two-plane split + handoff matrix in the package README and link
      it from onboarding (consumed by 0032).

## Test Plan

Tests run via the repo's vitest runner against the M18 fakes (in-memory GitHub) —
no real GitHub token, no provider quota.

```bash
# replace with the chosen stack's runner, e.g.:
pnpm -F @loopdog/github test
# - resolveRepoIdentity precedence + flag matrix (table test)
# - fork-PR event → writable:false → runner defers to sweep (fake-github scenario)
# - PAT set → fork-PR write proceeds; redaction test asserts token never serialized
```

## Verification Log

- 2026-06-09: identity suite green: PAT > GITHUB_TOKEN > CLI precedence;
  handoff matrix (actions=sweep, pat/human=instant); fork-PR read-only
  detection with PAT restore; token-never-serialized assertion. Runner
  fork-readonly defer wired (skipped record, never failed); controller
  resolves ambient identity flags into the runner deps.
- 2026-06-09: least-privilege manifest applied to both reusable workflows and
  asserted structurally by the governance suite (contents/issues/pull-requests
  write, checks read; nothing else).

## Decisions

- `resolveRepoIdentity` in `github/identity/repo-identity.ts` exactly per the
  spec'd shape; reTriggersWorkflows false iff source==='actions'.
- Fork detection compares head.repo.full_name vs repository.full_name (plus
  the fork flag) — robust to same-org branches.
- Defer semantics: a read-only identity in act mode records
  `deferred:fork-readonly` as a 'skipped' run-record step and waits for the
  sweep (the base-repo context) — never a failure, never a 403 surprise.
- contents:write IS granted (the plan store and telemetry write via the
  contents API); actions/deployments/id-token/security-events are not.

## Risks / Rollback

- **Fork-PR writes silently dropped** is the headline risk; the `writable` flag +
  defer-to-sweep must be in place before any acting loop is enabled on a public repo
  (else fork-triggered items strand). Rollback: gate acting loops to non-fork events
  until verified.
- **Token leakage** into logs/run-records — mitigated by the redaction test; treat a
  failure as release-blocking.
- Identity resolution is pure and additive, so rollback is reverting the
  `identity/` module + the templates' `permissions` block.

## Final Summary

Repo identity = the Actions GITHUB_TOKEN with PAT/CLI fallbacks, resolved by
one pure function carrying writable/reTriggersWorkflows flags; the runner
defers fork-readonly writes to the sweep; the reusable workflows ship the
least-privilege manifest; the provider-auth plane stays entirely in 0023's
resolveAuth — the two planes never mix.
