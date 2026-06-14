# Security & Trust Model

Loopdog's canonical statement of what it can and cannot do to your repo, where the
trust boundaries lie, and the honest residual risks — so you can decide to attach
it *before* your code, secrets, or subscription quota are ever exposed.

> **The one-paragraph trust model.** Loopdog is a controller in *your* repo's
> GitHub Actions. It runs on the repo's `GITHUB_TOKEN` (least-privilege, keyless),
> drives work on *your* Claude/Codex subscription (no model API key on the primary
> path), and uses **labels as its only state**. It is **safe by default**
> (dry-run; you promote per loop), it **cannot edit the checks that gate it**, and
> it **cannot merge `tier:core` without a human**.

Companion docs: [Trust Boundary & Secret Residency](trust-boundary.md) (where
every credential lives), [Resilience](resilience.md) (failure/quota controls).
Report vulnerabilities per [`SECURITY.md`](../SECURITY.md) (responsible disclosure).

## V1 non-negotiables

1. **Human-gated by default** — every loop ships `mode: dry-run` (observe +
   explain); acting is opt-in per loop, and `tier:core` merge stays human-gated
   even after promotion.
2. **Secrets never enter the loopdog-controlled model context** — project secrets
   marked `sensitive` are stripped before the agent phase (the Codex secret-phase
   model); the controller never puts a token into a prompt.
3. **Loopdog cannot edit its own gates** — the CI checks, branch protection, and
   the workflow files that gate it are outside its writable surface (blast-radius
   + `forbidden_paths`); a run cannot weaken the conditions of its own merge.

## Permission inventory

Every identity Loopdog touches, its scope, and who grants it. **There is no Loopdog
GitHub App, and no model API key on the primary path.**

| Identity | Scope | Grantor | Notes |
|---|---|---|---|
| Actions `GITHUB_TOKEN` | write `contents`/`issues`/`pull-requests`, read `checks` — this repo only | GitHub (auto) | the controller's identity; least-privilege manifest; controller writes don't re-trigger workflows |
| `LOOPDOG_PAT` (optional) | a PAT you scope | you | only to buy instant controller→controller handoff (else the cron sweep does it) |
| Codex provider App | the provider's GitHub App scopes | you (install) | the Codex subscription path |
| Claude routine fire URL + token | a per-routine bearer (Actions secret) | you (import via `loopdog login`) | the Claude subscription path — **not** an API key |
| Claude GitHub App (optional) | native trigger scopes | you | only if you want native triggers |
| OAuth `client_id` | sign-in only | provider | used by `loopdog login`; nothing is pasted |
| `LOOPDOG_MODEL_API_KEY` | a model API key | you | **self-hosted backend only** — the secondary, opt-in, key-holding escape hatch |

## Blast-radius guarantees

Each control and the milestone/task that owns it:

| Control | Guarantee | Owner |
|---|---|---|
| Dry-run default | nothing acts until promoted, per loop | M02 · 0009 |
| Risk tiers | `tier:core` never auto-merges (human-gated) | M03/M10 |
| `max_files` / `max_diff` / `forbidden_paths` | a run that exceeds its blast radius halts + escalates | M09 · 0038 |
| Budgets + kill switch | spend caps + an instant repo-variable halt | M12 · 0050 |
| Subscription quota gate | throttle/defer at the provider cap, never overrun | M12 · 0075 |
| Authorization gate (WHO/WHAT/WHEN) | untrusted triggers park for approval, never spend | M17 · 0079–0082 |
| Circuit breaker + concurrency ceiling | a provider outage pauses the loop; a load spike defers | M19 · 0090 |
| Quarantine | a poisoned item is held + recorded, never silently dropped | M19 · 0091 |
| Untamperable CI | the gating checks/workflows are outside the writable surface | M01/M03 |

## Threat model

| Attacker | Target asset | Mitigating control | Residual risk |
|---|---|---|---|
| Untrusted issue/PR author | repo writes, quota | authorization gate parks untrusted triggers (needs-approval); deny-wins | a trusted collaborator's account compromise bypasses it |
| Quota-drain abuser | your subscription | per-actor + global rate caps (M17), budget + quota gates (M12) | a high cap set by the maintainer is still drainable within it |
| Prompt injection (malicious issue text) | the work cell's actions | dry-run default, blast radius, DoR/DoD gates, human-gated merge, secrets stripped from model context | a promoted `act` loop can still be steered within its blast radius until review catches it |
| Provider-cloud compromise | code + brief sent to the provider | the [secret-residency boundary](trust-boundary.md) (no `sensitive` secrets in cloud agent context); ZDR org → no cloud routines | code content is necessarily visible to the provider you chose — see residency below |
| Malicious dependency / supply chain | the build | adapter runs in the sandboxed work cell; CI gates the merge | standard supply-chain risk of your own deps |

## What Loopdog can / cannot do

**Can:** label + comment on issues/PRs, open branches/PRs, update the durable
plan, dispatch work to your subscription, merge a non-`core` PR once DoD passes
(when the merge loop is promoted to act).

**Cannot:** merge `tier:core` without a human; edit the CI checks / branch
protection / workflow files that gate it; read or emit a `sensitive` project
secret into the model context; act at all while a loop is in dry-run; exceed a
run's blast radius, budget, quota, or the authorization gate.

## Provider-cloud residency boundary

Work cells run on the provider's cloud (Claude/Codex) or — opt-in — your own
self-hosted compute. The full statement of *what each path can read and verify*
is in [Trust Boundary & Secret Residency](trust-boundary.md) (task 0032): in
short, the provider necessarily sees the code + brief you dispatch; `sensitive`
secrets are stripped before that phase; a ZDR org excludes Claude cloud routines;
the self-hosted backend keeps everything on your compute (the only path that
holds a model API key).

## Open risk: ToS

Whether driving a *subscription* (vs. the metered API) for automation is within a
provider's Terms of Service is an **open question** Loopdog does not resolve —
tracked in the M00 validation spike (task 0092). Treat it as your decision; the
self-hosted/API path exists if you need to avoid it.

## Responsible disclosure

Found a vulnerability? Follow [`SECURITY.md`](../SECURITY.md) — do not open a
public issue for a security report.
