# Loopdog Trust Boundary & Secret Residency

> The honest statement (task 0032) of **where every credential lives, who can
> read it, and what each execution path can actually verify**. Read this
> before connecting accounts. Canonical background:
> [architecture.md](architecture.md) "Identity & secrets (two planes)" and
> "The honest constraints".

## The two planes (and loopdog's own identity)

- **Loopdog's repo identity** is the Actions **`GITHUB_TOKEN`** of *your*
  repository — keyless, auto-scoped, write access only to your repo via the
  least-privilege manifest (`contents`, `issues`, `pull-requests` write;
  `checks` read; nothing else). Controller-written changes don't re-trigger
  workflows, so controller→controller handoffs ride the cron sweep; an
  optional `LOOPDOG_PAT` buys instant handoff. **No loopdog GitHub App exists.**
- **Provider-auth plane** — your Claude/Codex **subscription**, connected
  through the provider's validated surface: Claude = a manually-imported
  routine (`/fire` URL + per-routine bearer token stored as Actions secrets);
  Codex = the provider's GitHub App. **No model API key on this path.**
- **Project-secret plane** — the secrets your build/test/deploy needs. On the
  primary path these live in the **provider's** cloud environment; on the
  self-hosted path they live in **your own** runner/container, injected from
  your own store.

One rule everywhere: **loopdog never serializes a long-lived credential into
prompts, plans, comments, run records, or any artifact it controls.** The
scrubber redacts registered values (and their base64/URL/JSON encodings) plus
known token patterns on every egress path, and fails closed.

## Residency matrix

| Secret class | Claude cloud | Codex cloud | Self-hosted |
|---|---|---|---|
| Loopdog repo identity (`GITHUB_TOKEN`/PAT) | Your Actions runner only; never sent to the provider | same | same |
| Provider subscription auth | Imported routine `/fire` URL + bearer token as Actions secret refs (`LOOPDOG_CLAUDE_FIRE_URL/TOKEN`); repo + cloud environment configured in Claude's web UI | Codex provider App authorization — loopdog holds **no** token | n/a — uses your own model API key |
| Model API key | **none** on the primary path | **none** on the primary path | **your own**, named by `LOOPDOG_MODEL_API_KEY` (or your secret name); resolved only inside your worker job; never model-visible |
| Project build/test/deploy secrets | Configured in **Claude's cloud environment** (web UI); loopdog does **not** forward Actions secrets at `/fire` time; visible to anyone who can edit that environment | Provider cloud env via setup scripts — **stripped before the agent phase** | Your runner/container, injected from your store (`actions`/`vault`/`doppler`; OIDC via your cloud's exchange action), scrubbed from all model-visible output |

**Accept this before adopting the primary path:** your code and any secrets
you configure into a provider cloud environment reside in Anthropic/OpenAI
infrastructure. That is the trade for zero-infra adoption. If that residency
is unacceptable (ZDR orgs, production-grade credentials), use the self-hosted
backend — nothing leaves your compute.

## The Codex constraints, plainly

Codex strips secrets before the agent phase and disables agent-phase internet
by default. Consequence: **tests needing live credentials or network may not
run inside the Codex work cell.** Loopdog therefore treats **your own GitHub
Actions CI as the trustworthy verification gate (ladder rung 2) regardless of
where the work cell ran** — the provider sandbox is for *producing* the
change, never for *trusting* it. Mark such loops `requires: { live_secrets:
true }` and loopdog flags the mismatch at validate time with a self-hosted
directive.

## What each path can verify (ladder rungs × backends)

| Verification rung | Claude cloud | Codex cloud | Self-hosted |
|---|---|---|---|
| 1. Work-cell self-test | yes (sandbox has env you configured in Claude) | partial (no secrets/network in agent phase) | yes (full secrets + network) |
| 2. **Your CI required checks** | **yes — the floor, always trustworthy** | **yes** | **yes** |
| 3. Cross-provider review | yes | yes | yes |
| 4. Deploy smoke/canary | via your CI/adapter | via your CI/adapter | yes, in your runner |

## Known limits & flagged risks

- Claude cloud environments have **no dedicated secret store** — env values
  are visible to anyone who can edit the environment. Mark production-grade
  values `sensitivity: sensitive` and loopdog warns you toward self-hosted.
- Claude routines are a **research preview** (pinned beta header) — the
  surface may change; the gated live-smoke exists to catch drift.
- The **ToS posture** (third-party orchestration of subscription quota) is
  documented in `.agent/reports/0092-tos-findings.md`: explicitly permitted
  for Claude's `/fire` pattern; gray-area for Codex mentions — loopdog ships
  "acts as you, on your repos, within your limits", one account per adopter,
  no hosted multi-tenant mode.

See also: [connecting accounts](walkthroughs/connecting-accounts.md) ·
`loopdog connect claude|codex` · the self-hosted worker template
(`templates/workflows/loopdog-self-hosted-worker.yml`).
