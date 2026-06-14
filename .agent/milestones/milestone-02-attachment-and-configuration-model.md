# Milestone 02: Attachment & Configuration Model

Status: implemented (live provider connects + device-flow login operator-pending)

> Background: [Loopdog Architecture](../../docs/architecture.md) — "How loopdog
> attaches to a repo," "Execution model," and "Triggering: events for latency,
> cron for resilience." The defining "generic & attachable" milestone; also covers
> connecting the adopter's provider subscriptions and both trigger modes.

## Objective

Define how loopdog attaches to *any* GitHub repo: a validated config — a root
`loopdog.yml` for global defaults (tiers, budgets/quota, provider + execution
backend, plan store) plus **one file per loop** under `.loopdog/loops/<name>/`, a
`loopdog init` CLI that scaffolds config + reusable workflow callers and previews
behavior, safe-by-default dry-run, an onboarding path that connects the adopter's
**Claude/Codex subscription** through the provider's validated repo-connect
surface (manual routine import for Claude; provider App for Codex), and controller
triggers that run loops on **both GitHub events and a scheduled reconcile sweep**.

## Guiding Decisions

- Zero-config defaults that work on a plain repo; everything overridable in
  `.loopdog/loopdog.yml`.
- Adoption is **zero-infra**: the provider hosts the agent sandbox; loopdog's thin
  controller runs in the adopter's GitHub Actions (or via the CLI).
- Loops run on **two trigger modes**: GitHub **events** for low latency, and a
  **cron reconcile sweep** as the backstop that recovers missed/dropped events and
  drives time-based transitions — the standard *watch + periodic resync* pattern,
  so the board is eventually-consistent even when a webhook is lost.
- Onboarding connects the **provider subscription** (Claude manual routine import
  with repo/environment setup + `/fire` secret refs; Codex provider App install +
  repo authorization; pick the execution backend per loop) — not model API keys on
  the primary path.
- Auth is a **browser login via the CLI** (`loopdog login`): GitHub OAuth device
  flow (public OAuth-App client_id, no hosted backend) — or reuse existing
  `gh`/git auth — connecting the user locally + the provider subscription; no PATs
  or API keys to fumble; tokens in the OS keychain. **In CI the controller uses the
  Actions `GITHUB_TOKEN`** (no loopdog GitHub App; M07).
- **One file per loop, not a monolith.** Global settings live in a root
  `loopdog.yml`; each loop is its own folder `.loopdog/loops/<name>/` (`loop.yml` +
  `prompt.md`). Adding/removing a loop is adding/removing a folder — no giant
  shared file to merge-conflict on. Loops are declarative (trigger, from→to
  transition, backend, gates + a prompt), authored via `loopdog loops new` (M16).
- New installs are **dry-run / human-gated** until the adopter promotes autonomy.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0006 | verified | task/0006-config-schema-and-validation | Config Schema & Validation | Root `loopdog.yml` (tiers, budgets/quota, backend, plan store) + per-loop `.loopdog/loops/<name>/loop.yml` schema; validator across both. |
| 0007 | verified | task/0007-init-cli-and-scaffolding | `loopdog init` CLI & Scaffolding | CLI that writes config + workflow callers and previews planned actions. |
| 0008 | verified | task/0008-event-driven-triggers | Event-Driven Triggers | Reusable Actions on GitHub event/action matrix (issues/comments/PRs/reviews/checks/status/workflow-run, item labels, merged PRs) → controller dispatch (low latency); handoffs `GITHUB_TOKEN` won't re-trigger are carried by the sweep (0076). |
| 0076 | verified | task/0076-cron-reconcile-sweep | Cron Reconcile Sweep | Scheduled Actions that scan state and advance stuck/missed items + drive time-based transitions; the resilience backstop. |
| 0009 | verified | task/0009-dry-run-and-safe-defaults | Dry-Run & Safe Defaults | Comment-only/no-write mode that is the default until promoted. |
| 0077 | implemented | task/0077-cli-github-connector-and-login | CLI GitHub Connector & `loopdog login` | Keyless login: GitHub OAuth device flow (public client_id, no backend) or reuse existing `gh`/git auth; secure token storage; chains into provider connect. CI uses `GITHUB_TOKEN` (no loopdog App). |
| 0010 | implemented | task/0010-subscription-onboarding-and-backend-select | Subscription Onboarding & Backend Select | Guided provider connect (Claude routine import; Codex App authorization), repo authorization, per-loop backend choice. |

## Definition Of Done

- [x] A documented config schema — root `loopdog.yml` plus per-loop
  `.loopdog/loops/<name>/loop.yml` — validated with per-field errors; no
  monolithic config file (0006; 7-test suite).
- [x] `loopdog init` scaffolds a working attachment on a fresh repo and previews
  what loopdog would do without writing (0007; idempotent, conflict-protected).
- [x] The controller runs on **GitHub events** (0008: matrix + reusable
  workflow + matcher) **and** a **scheduled reconcile sweep** (0076: 6-test
  suite incl. stranded-item recovery — no item permanently stranded).
- [~] A single `loopdog login` connects via existing `gh` or device flow with
  keychain storage — implemented; the live device-flow round-trip needs a
  registered OAuth App client_id (operator; release prereq in 0066).
- [~] Claude/Codex connect via the validated surfaces (manual routine import /
  provider App) with idempotent re-runs and per-loop backend choice —
  implemented; live provider round-trips are operator-pending (0093 kit).
- [x] Dry-run is the default; promotion is explicit (`loopdog promote`, audited,
  tier:core merge guard) and documented (0009; zero-mutation proof).

## Verification Log

- 2026-06-09: all seven tasks landed. 83 tests green across config (schemas/
  discovery/validation/cron), runtime (runner modes, sweep), cli (init plan +
  idempotence, promote + guard, token store). Build/lint/boundaries clean.
- 2026-06-09: end-to-end attach exercised in a temp repo: init --dry-run (0
  writes) → init --yes (15 files, validation OK) → config validate → promote
  groom → re-run init (14 skips + 1 protected conflict) → connect default
  backend edits.
