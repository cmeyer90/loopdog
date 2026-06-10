# 0062 Security & Trust Model

Status: planned  
Branch: task/0062-security-and-trust-model

## Goal

Publish looper's canonical **security & trust model**: a single document that
states the threat model, looper's permissions and blast-radius guarantees, what
it can and cannot do to a repo, where the subscription-driving / provider-cloud
trust boundaries lie, and the open ToS question — so a maintainer can make an
informed decision to attach looper *before* their code, secrets, or subscription
quota are ever exposed.

## Background

Part of [Milestone 14](../milestones/milestone-14-documentation-examples-and-trust.md):
the adoption surface for an open-source tool. The milestone's guiding decision is
that **trust is earned with an explicit threat model and a clear statement of
what looper can and cannot do to a repo** — this task is that artifact. It fills
the `trust/security.md` nav slot the docs site (0058) reserves, peer to the
quickstart and references.

This is the *security* synthesis doc; the *secret-residency* doc is a sibling
(0032, `docs/trust-boundary.md`) and this task **links it, does not duplicate
it**. Grounded in [architecture](../../docs/architecture.md) "Identity & secrets
(two planes)", "Authorization & trigger control", "The verification ladder
(trust)", "The honest constraints (these shape V1)", and "V1 scope"
(Non-negotiable for V1). It describes behavior implemented elsewhere —
authorization (M17 · 0079), budgets/kill-switch (M12 · 0050), the cron sweep
(0076), provider auth & scoped identity (0029), and the secret-residency doc
(0032) — it does not implement them. The ToS spike (0092) is referenced as a
flagged adoption risk, never as resolved. No new `@looper/*` runtime code beyond
docs plus one drift-guard assertion.

## Scope

- A new doc, `docs/security.md` (surfaced as `trust/security.md` in the 0058 nav),
  structured as: trust model → threat model → permission & blast-radius
  guarantees → "what looper can / cannot do" → subscription & provider-cloud
  residency (link 0032) → ToS posture → responsible-disclosure.
- A **permission inventory**: every identity/token looper uses, its scope, and
  who grants it (Actions `GITHUB_TOKEN`, optional PAT, Codex provider GitHub App,
  Claude routine `/fire` token, optional Claude GitHub App only for
  Claude-native GitHub triggers, local OAuth device-flow client_id).
- A **blast-radius guarantee table**: the concrete limits that bound damage —
  `mode: dry-run` default, risk tiers (`tier:safe` graduated auto-merge,
  `tier:core` human-gated forever via CODEOWNERS), `blast_radius.max_files`,
  budgets/quota/kill-switch (0050), authorization gate (0079), and the rule
  *looper can never edit the checks (ladder rung 2) that gate it*.
- A **threat model** enumerating attacker classes, the asset each targets, the
  control that mitigates it, and the honest residual risk.
- A drift guard: a presence/link assertion so the doc cannot silently rot or
  become unreferenced from onboarding/quickstart.

### Technical detail

**Lands in:** `docs/` (the doc) + a tiny vitest assertion in the `docs`/`config`
test area (or the existing docs-link check from M01 · 0003). No `core`/`runtime`
code. The doc is `docs/security.md`, peer to `architecture.md`, `codebase.md`,
and `trust-boundary.md` (0032); the 0058 nav exposes it under **Trust →
Security**.

**Document spine (sections, in order):**

1. **Trust model in one paragraph** — looper is *pure orchestration*: it
   manipulates GitHub state and dispatches to provider cloud agents; **it makes
   no direct model API calls on the primary path** and runs **no looper-hosted
   infrastructure** (no database, queue, or hosted backend — GitHub is the store
   and the bus). The non-negotiables (architecture "V1 scope"): human-gated by
   default; secrets never in model-visible context looper controls; **looper can
   never edit the checks that gate it**; the provider-cloud boundary stated
   plainly.

2. **Permission inventory** — one row per credential: *identity · scope · granted
   by · resides where · what it can do*.

   | Identity | Scope | Granted by | Resides | Capability |
   |---|---|---|---|---|
   | Actions `GITHUB_TOKEN` | repo-scoped, auto | GitHub Actions | adopter's runner | read/write labels, issues, PRs, comments, claims; **does not re-trigger workflows** (handoffs go via the cron sweep, 0076) |
   | Optional PAT (fine-grained) | adopter-chosen | adopter, in repo secret | adopter's runner | instant controller→controller handoff (else sweep pace) — **never required** |
   | Codex provider GitHub App | provider-defined | provider, adopter authorizes repos | provider | lets Codex respond to `@codex` mentions and open PRs on the user's subscription |
   | Claude routine fire URL/token | routine `/fire` only | adopter, generated in Claude web UI | looper keychain / Actions secret refs | dispatch a user-created Claude routine |
   | Optional Claude GitHub App | provider-defined | provider, adopter authorizes repos | provider | required only for Claude-native GitHub triggers outside Looper's primary `/fire` path |
   | Local OAuth `client_id` (device flow) | user login | public OAuth App (no private key, no hosted backend) | OS keychain | authenticate the CLI user locally; *or* reuse existing `gh`/git auth |

   State plainly: **there is no looper GitHub App in V1** and **no model API key
   on the primary path** (keys exist only on the optional self-hosted backend).

3. **Blast-radius guarantees** — the layered controls that bound damage, each
   mapped to its owning task; explicitly which a loop may *not* tune about itself:

   | Guarantee | Mechanism | Owner |
   |---|---|---|
   | Safe by default | `mode: dry-run`; autonomy granted by *promotion* | 0007 / 0058 |
   | Graduated auto-merge | `tier:safe` may auto-merge; `tier:core` human-gated forever (CODEOWNERS) | M10 |
   | Bounded change size | `blast_radius.max_files`; scope-exceeding work halts + escalates | M09 |
   | Spend & quota ceilings + kill switch | budgets/quota/kill-switch checked **before any dispatch** | M12 · 0050 |
   | Who/what/when may trigger | authorization gate; untrusted trigger is *parked* (`needs-approval`), no spend, until a trusted human releases it | M17 · 0079 |
   | Untamperable verification | merge gated on the adopter's CI (rung 2) + branch protection + CODEOWNERS, which **looper cannot edit** | M10 |

   Make the load-bearing invariant explicit: the verification ladder + risk tiers
   are **the one dial a loop must never tune about itself** (architecture "The
   adopter's end-state job").

4. **What looper *can* / *cannot* do** — two plain lists. *Can*: read/write the
   repo's issues/PRs/labels/comments as `GITHUB_TOKEN`; dispatch the user's
   subscription quota to a provider; open/advance PRs through the gated lifecycle;
   write durable plans into the repo. *Cannot*: edit the required checks / branch
   protection / CODEOWNERS that gate it; merge `tier:core` without a human; make
   arbitrary model API calls (no key on the primary path); exfiltrate project
   secrets into model-visible context it controls (it scrubs them); act on an
   untrusted trigger without trusted-human approval.

5. **Threat model** — attacker class → target asset → control → residual risk:

   | Attacker | Targets | Control | Residual risk |
   |---|---|---|---|
   | Anonymous issue/comment on a public repo | subscription quota drain; prompt-injection into a work cell | authorization gate parks untrusted triggers before any dispatch (0079); budgets/kill-switch (0050) | injection inside an *approved* item's content still reaches the work cell — bounded by blast-radius + gates |
   | Untrusted/self-approving actor | bypass the gate | a self-approval by the untrusted actor doesn't count; strictest rule wins (0079) | misconfigured allowlist widens the surface — documented as the adopter's responsibility |
   | Compromised/malicious PR from a work cell | merge bad code | rungs 2–4 (adopter CI, cross-provider review, deploy smoke) gate merge; looper can't edit them | a *human* approving `tier:core` is the backstop; CI coverage gaps are the adopter's risk |
   | Provider/cloud-sandbox compromise | adopter's code + project secrets in provider infra | residency boundary stated honestly (0032); secrets scrubbed from looper-controlled context; ZDR orgs use self-hosted | the residency decision is the adopter's to accept (link 0032) |
   | Stolen `GITHUB_TOKEN` / PAT / routine token | repo write / dispatch | tokens are short-lived (`GITHUB_TOKEN`) or adopter-held; least privilege; no looper-hosted secret store | a leaked PAT grants instant-handoff scope until revoked |
   | Supply-chain (looper itself) | the controller code | open-source + pinned deps + the dogfood example (0061) | standard OSS supply-chain risk; out of scope to fully solve here |

6. **Subscription-driving & provider-cloud residency** — restate the trust
   boundary *briefly* and **link 0032 (`docs/trust-boundary.md`)** for the full
   residency matrix and the Codex secret-stripping / no-internet constraints. Make
   the enforceable rule prominent: looper never serializes a long-lived credential
   into prompts, plans, comments, run records, logs, or other model/GitHub-visible
   artifacts it controls.

7. **ToS posture** — programmatic third-party driving of a user's subscription
   quota is **not squarely sanctioned by either provider's public docs**; link the
   ToS spike (0092) as a flagged, unresolved adoption risk. **Do not imply
   resolution.** Note the self-hosted/API backend as the escape hatch where the
   subscription path can't or shouldn't be used.

8. **Responsible disclosure** — a short `SECURITY.md`-style section (or a
   pointer to a top-level `SECURITY.md`): how to report a vulnerability and the
   expected response posture. Keep it minimal and honest for an OSS V1.

**Drift guard:** add a vitest presence/link assertion (in the `docs`/`config`
test area, or extend 0003's docs-link CI) that fails if `docs/security.md` is
missing or is unreferenced from the quickstart (0058) / onboarding. No quota,
no provider calls, fully offline.

## Out Of Scope

- Implementing authorization (0079), budgets/kill-switch (0050), provider auth
  (0029), or scrubbing/leak-guards (0031) — this documents them.
- The secret-**residency** matrix and Codex-constraint detail — owned by 0032;
  this doc links it.
- The ToS legal determination itself (0092).
- The docs-site shell, nav, and Pages deploy (0058) — this fills its `trust`
  slot only.
- Any new looper GitHub App, API-keys on the primary path, or database/queue.

## Acceptance Criteria

- [ ] `docs/security.md` exists and opens with the one-paragraph trust model and
      the V1 non-negotiables (human-gated default; secrets never in
      looper-controlled model context; looper can never edit the gating checks).
- [ ] A permission inventory names every identity (Actions `GITHUB_TOKEN`,
      optional PAT, Codex provider App, Claude routine fire URL/token, optional
      Claude GitHub App for native triggers, OAuth `client_id`) with scope and
      grantor, and states **no looper GitHub App** and **no model API key on the
      primary path**.
- [ ] A blast-radius guarantee table maps each control (dry-run default, risk
      tiers, `max_files`, budgets/kill-switch, authorization gate, untamperable CI)
      to its owning milestone/task.
- [ ] A threat model enumerates attacker classes with target asset, mitigating
      control, and honest residual risk — including quota drain, prompt injection,
      and provider-cloud compromise.
- [ ] Explicit "what looper can / cannot do" lists, including that it cannot edit
      the checks that gate it and cannot merge `tier:core` without a human.
- [ ] The provider-cloud residency boundary is stated and **links 0032**; the ToS
      question links 0092 as an open risk without implying resolution.
- [ ] A responsible-disclosure section (or pointer to `SECURITY.md`) exists.
- [ ] The quickstart (0058) / onboarding links to it; the drift guard fails if the
      doc is missing or unreferenced.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Inspect 0032 / 0079 / 0050 / 0029 / 0076 so the security doc stays
      consistent and links rather than duplicates.
- [ ] Draft `docs/security.md` following the eight-section spine above.
- [ ] Build the permission inventory, blast-radius guarantee, and threat-model
      tables.
- [ ] Write the can/cannot lists and the ToS-posture paragraph (link 0092).
- [ ] Add the responsible-disclosure section / `SECURITY.md` pointer.
- [ ] Cross-link 0032, 0050, 0079, 0076, 0058, 0092 and the relevant
      architecture sections.
- [ ] Add the link from the quickstart / onboarding and the drift-guard assertion.

## Test Plan

Tests run via the repo's chosen vitest runner; no real quota or provider calls,
fully offline. Behavioral checks (none here) would use the M18 fakes — this is a
docs task, so the only test is the drift guard plus a relative-link check.

```bash
# replace with the chosen stack's runner
# drift guard: assert docs/security.md exists and is linked from the quickstart/onboarding
# markdown relative-link check passes (no dead links in the new doc; 0032/0092 resolve)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final doc location (`docs/security.md` vs. a `trust/` subfolder), the
exact threat-model rows, whether responsible-disclosure lives inline or in a
top-level `SECURITY.md`, and where the drift guard lives (docs CI vs. a vitest
assertion).

## Risks / Rollback

The main risk is an **overconfident or stale** security doc: adopters grant
looper access to their repo and subscription based on it, so any guarantee it
states must be one the code actually enforces (link the owning task for each).
Keep the threat model honest about residual risk, link the ToS spike (0092)
rather than implying resolution, and let the drift guard enforce the doc's
existence and references. Rollback is trivial: it is additive documentation plus
one assertion; delete the file and the guard to revert with no runtime impact.

## Final Summary

Fill this in before marking verified.
