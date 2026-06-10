# 0032 Secret Trust-Boundary & Constraints Doc

Status: planned  
Branch: task/0032-secret-trust-boundary-doc

## Goal

Write the honest, canonical trust-boundary document for looper: where every kind
of secret resides per backend, what the Codex agent-phase secret-stripping /
no-internet constraints mean for tests, and exactly what each execution path can
and cannot *verify* — so adopters make an informed residency decision before
their code or secrets enter a provider's cloud. Reference it from onboarding.

## Background

Part of [Milestone 07](../milestones/milestone-07-secrets-and-identity.md). The
milestone establishes the **two-plane** secret model (provider-auth plane +
project-secret plane) and the enforceable rule that looper never serializes a
long-lived credential into prompts, plans, comments, run records, logs, or other
GitHub/model-visible artifacts it controls; this task is the documentation
deliverable that makes the boundary legible. Grounded in
[architecture](../../docs/architecture.md)
"Identity & secrets (two planes)", "The honest constraints (these shape V1)", and
"The verification ladder (trust)". It depends on the *behavior* defined by repo
identity & provider auth (0029), provider cloud env/secret config (0030), and
self-hosted secret injection & leak guards (0031); this doc describes that
behavior, it does not implement it. Onboarding (0010) and `looper login`
([connecting-accounts walkthrough](../../docs/walkthroughs/connecting-accounts.md))
link to it. No new code beyond docs + one assertion that the doc stays in sync.

## Scope

- A new doc, `docs/trust-boundary.md`, structured around the planes and backends.
- A per-backend residency matrix: for Claude cloud, Codex cloud, and self-hosted,
  state where each secret class lives and who can read it.
- A plain statement of the Codex agent-phase constraints (secrets stripped, no
  agent-phase internet) and the concrete consequence: which tests can/can't run in
  the work cell, and why the adopter's CI (ladder rung 2) is the trustworthy gate.
- A "what each path can verify" table mapping the verification ladder rungs to
  each backend, so adopters know which rungs are real for their setup.
- The provider-auth-plane statement: no long-lived model API key on the primary
  path; Claude manual routine import (`/fire` URL + bearer-token secret refs) and
  Codex provider App; ZDR exclusion.
- Cross-links: onboarding (0010), backend selection (0023), self-hosted leak
  guards (0031), the ToS spike (0092) as a flagged adoption risk.

### Technical detail

**Lands in:** `docs/` (the doc) + a tiny check in the `docs`/`config` area; no
`@looper/*` runtime code. The doc is `docs/trust-boundary.md`, peer to
`architecture.md`/`codebase.md`.

**Two planes (restate canonically, link don't duplicate):**

- *Provider-auth plane* — the user's Claude/Codex subscription via the provider's
  validated surface: Claude routine import (`/fire` URL + bearer-token secret
  refs, with repo/environment configured in Claude) and Codex provider App. Usually
  **no model API key** for looper to store on the primary path. Looper's own repo
  identity is the Actions `GITHUB_TOKEN` (handoffs via the cron sweep, 0076;
  optional PAT for instant) — **not** a secret plane and **not** a looper GitHub
  App.
- *Project-secret plane* — build/test/deploy secrets the work cell needs. Primary
  path: configured into the **provider's** cloud env (0030). Self-hosted: injected
  into the adopter's runner/container from their own store (0031).

**Residency matrix** (the doc's centerpiece — one row per secret class, one column
per backend; each cell = *where it resides* + *who can read it*):

| Secret class | Claude cloud | Codex cloud | Self-hosted |
|---|---|---|---|
| Looper repo identity (`GITHUB_TOKEN`/PAT) | Adopter's Actions runner only; never sent to provider | same | same |
| Provider subscription auth | Imported routine `/fire` URL + bearer token as keychain/Actions `SecretRef`s; repo/environment setup in Claude | Codex provider App (no token) | n/a (uses adopter's own model API key) |
| Model API key | none on primary path | none on primary path | **adopter's own**, in adopter's store, never model-visible |
| Project build/test/deploy secrets | Claude cloud environment configured in Claude's web UI; not forwarded from Actions at `/fire` | provider cloud env, **stripped before agent phase** | adopter's runner/container, scrubbed from model context |

**Codex constraints subsection (state the consequence plainly):** secrets are
stripped before the agent phase and agent-phase internet is disabled by default →
tests needing live credentials or network may not run inside the work cell. Looper
therefore treats the adopter's own GitHub Actions CI as the trustworthy gate
(rung 2) *regardless of where the work cell ran* — the sandbox produces the change,
CI is what trusts it. Codex cloud is also quota-capped (~5 tasks/hr lower tiers).

**"What each path can verify" table** — map ladder rungs 1–5 to each backend so an
adopter sees, e.g., that on Codex rung-1 self-test is *limited* (no live
secrets/network) but rung 2 (their CI) is full; on self-hosted rung 1 *recovers*
full secret/network access. Make explicit that rungs 2–4 (CI, cross-provider
review, deploy smoke) are backend-independent and gate merge.

**The one rule, stated up top:** *looper never serializes a long-lived credential
into prompts, plans, comments, run records, logs, or other model/GitHub-visible
artifacts it controls* — and looper scrubs secrets from egress it controls.
Backend env residency is stated separately; looper can never edit the checks
(rung 2) that gate it.

**Edge cases to cover:** ZDR orgs (excluded from Claude cloud → must use
self-hosted); tests that need real network/secrets (subscription path can't serve
→ self-hosted escape hatch); ToS uncertainty (link 0092 as a flagged adoption
risk, not an assumption); the residency decision is the adopter's to accept.

**Drift guard:** add a doc-presence/link assertion (a vitest test in the `docs` or
`config` test area, or an entry in the existing docs-link check from 0003's CI)
that fails if `docs/trust-boundary.md` is missing or unreferenced from onboarding,
so the boundary can't silently rot. No quota/provider calls.

## Out Of Scope

- Implementing identity/auth (0029), cloud env/secret config (0030), or
  self-hosted injection/leak-guard *code* (0031) — this is documentation of them.
- Scrubbing implementation, budget/quota enforcement (M12), the ToS legal
  determination itself (0092).
- Any new looper GitHub App, API-keys on the primary path, or database/queue.

## Acceptance Criteria

- [ ] `docs/trust-boundary.md` exists and states the one rule (looper never
      serializes long-lived credentials into model/GitHub-visible artifacts it
      controls) up top.
- [ ] It documents both planes (provider-auth + project-secret) and names the
      Actions `GITHUB_TOKEN` as looper's repo identity (no looper GitHub App).
- [ ] A per-backend residency matrix covers Claude cloud, Codex cloud, and
      self-hosted for each secret class, stating where it resides and who reads it.
- [ ] The Codex agent-phase secret-stripping + no-internet constraints are stated,
      with the consequence: adopter CI (rung 2) is the trustworthy verification gate.
- [ ] A "what each path can verify" table maps the ladder rungs to each backend.
- [ ] It states no long-lived model API key on the primary path, documents Claude
      routine import vs. Codex provider App, states the ZDR exclusion →
      self-hosted, and flags the ToS question (0092) as an open risk.
- [ ] Onboarding (0010) and `looper login` docs link to it; the drift guard fails
      if the doc is missing or unreferenced.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Draft `docs/trust-boundary.md` following the section structure above.
- [ ] Build the residency matrix and the verify-per-path table.
- [ ] Write the Codex-constraints subsection and the self-hosted recovery note.
- [ ] Cross-link 0010, 0023, 0031, 0076, 0092 and the verification-ladder section.
- [ ] Add the link from onboarding docs / `looper login` output.
- [ ] Add the doc-presence + link drift-guard assertion.

## Test Plan

Tests run via the repo's chosen vitest runner; no real quota or provider calls.

```bash
# replace with the chosen stack's runner
# docs drift guard: assert docs/trust-boundary.md exists and is linked from onboarding
# markdown link check passes (no dead relative links in the new doc)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final doc location, the exact residency-matrix columns/rows, and where
the drift guard lives (docs CI vs. a vitest assertion).

## Risks / Rollback

Main risk is a *dishonest* or stale boundary doc — adopters trust their code/secrets
to a provider's cloud based on it. Keep it brutally accurate, link the ToS spike
(0092) rather than implying resolution, and let the drift guard enforce its
existence. Rollback is trivial: it is additive documentation; delete the file and
the guard to revert.

## Final Summary

Fill this in before marking verified.
