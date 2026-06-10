# Milestone 02: Attachment & Configuration Model

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "How looper
> attaches to a repo," "Execution model," and "Triggering: events for latency,
> cron for resilience." The defining "generic & attachable" milestone; also covers
> connecting the adopter's provider subscriptions and both trigger modes.

## Objective

Define how looper attaches to *any* GitHub repo: a validated config — a root
`looper.yml` for global defaults (tiers, budgets/quota, provider + execution
backend, plan store) plus **one file per loop** under `.looper/loops/<name>/`, a
`looper init` CLI that scaffolds config + reusable workflow callers and previews
behavior, safe-by-default dry-run, an onboarding path that connects the adopter's
**Claude/Codex subscription** through the provider's validated repo-connect
surface (manual routine import for Claude; provider App for Codex), and controller
triggers that run loops on **both GitHub events and a scheduled reconcile sweep**.

## Guiding Decisions

- Zero-config defaults that work on a plain repo; everything overridable in
  `.looper/looper.yml`.
- Adoption is **zero-infra**: the provider hosts the agent sandbox; looper's thin
  controller runs in the adopter's GitHub Actions (or via the CLI).
- Loops run on **two trigger modes**: GitHub **events** for low latency, and a
  **cron reconcile sweep** as the backstop that recovers missed/dropped events and
  drives time-based transitions — the standard *watch + periodic resync* pattern,
  so the board is eventually-consistent even when a webhook is lost.
- Onboarding connects the **provider subscription** (Claude manual routine import
  with repo/environment setup + `/fire` secret refs; Codex provider App install +
  repo authorization; pick the execution backend per loop) — not model API keys on
  the primary path.
- Auth is a **browser login via the CLI** (`looper login`): GitHub OAuth device
  flow (public OAuth-App client_id, no hosted backend) — or reuse existing
  `gh`/git auth — connecting the user locally + the provider subscription; no PATs
  or API keys to fumble; tokens in the OS keychain. **In CI the controller uses the
  Actions `GITHUB_TOKEN`** (no looper GitHub App; M07).
- **One file per loop, not a monolith.** Global settings live in a root
  `looper.yml`; each loop is its own folder `.looper/loops/<name>/` (`loop.yml` +
  `prompt.md`). Adding/removing a loop is adding/removing a folder — no giant
  shared file to merge-conflict on. Loops are declarative (trigger, from→to
  transition, backend, gates + a prompt), authored via `looper loops new` (M16).
- New installs are **dry-run / human-gated** until the adopter promotes autonomy.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0006 | planned | task/0006-config-schema-and-validation | Config Schema & Validation | Root `looper.yml` (tiers, budgets/quota, backend, plan store) + per-loop `.looper/loops/<name>/loop.yml` schema; validator across both. |
| 0007 | planned | task/0007-init-cli-and-scaffolding | `looper init` CLI & Scaffolding | CLI that writes config + workflow callers and previews planned actions. |
| 0008 | planned | task/0008-event-driven-triggers | Event-Driven Triggers | Reusable Actions on GitHub event/action matrix (issues/comments/PRs/reviews/checks/status/workflow-run, item labels, merged PRs) → controller dispatch (low latency); handoffs `GITHUB_TOKEN` won't re-trigger are carried by the sweep (0076). |
| 0076 | planned | task/0076-cron-reconcile-sweep | Cron Reconcile Sweep | Scheduled Actions that scan state and advance stuck/missed items + drive time-based transitions; the resilience backstop. |
| 0009 | planned | task/0009-dry-run-and-safe-defaults | Dry-Run & Safe Defaults | Comment-only/no-write mode that is the default until promoted. |
| 0077 | planned | task/0077-cli-github-connector-and-login | CLI GitHub Connector & `looper login` | Keyless login: GitHub OAuth device flow (public client_id, no backend) or reuse existing `gh`/git auth; secure token storage; chains into provider connect. CI uses `GITHUB_TOKEN` (no looper App). |
| 0010 | planned | task/0010-subscription-onboarding-and-backend-select | Subscription Onboarding & Backend Select | Guided provider connect (Claude routine import; Codex App authorization), repo authorization, per-loop backend choice. |

## Definition Of Done

- A documented config schema — root `looper.yml` plus per-loop
  `.looper/loops/<name>/loop.yml` (provider/backend + trigger config) — is
  validated with clear errors; no single monolithic config file.
- `looper init` scaffolds a working attachment on a fresh repo and previews what
  looper would do without writing.
- The controller runs on **GitHub events** (low latency) **and** a **scheduled
  reconcile sweep** (backstop); a dropped/missed event is recovered by the next
  sweep, so no item is permanently stranded by a lost webhook.
- A single `looper login` connects the user to GitHub and their provider via
  browser OAuth (device flow) or existing `gh` — no manual tokens, no API keys, no
  looper GitHub App (CI uses `GITHUB_TOKEN`; keys only on the self-hosted backend).
- The adopter can connect a Claude and/or Codex subscription through the validated
  provider surface (manual routine import for Claude; provider App for Codex) and
  choose a backend per loop.
- Dry-run is the default; promotion to act is explicit and documented.

## Verification Log

Add dated entries as tasks land.
