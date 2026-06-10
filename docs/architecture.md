# Looper — Architecture & Vision

> North-star design doc. The V1 roadmap that implements it lives as milestones
> under [`.agent/milestones.md`](../.agent/milestones.md); this doc is the
> canonical "why" those milestones link back to. Keep background here, not
> duplicated across milestone files. For concrete end-to-end usage, see the
> [walkthroughs](walkthroughs/README.md) (connect accounts · a ticket's lifecycle
> · creating a loop); for the module boundaries and filetree, see
> [codebase.md](codebase.md).

## What Looper Is

Looper is a **generic, open-source orchestrator of autonomous SDLC loops that you
attach to any GitHub repository — driven by your _existing_ Claude Code and Codex
subscriptions.** Control loops watch a repo's issues and PRs and drive work
through the lifecycle (groom → implement → review → merge → deploy), writing
durable plans into the repo as they go.

The defining choice (verified against provider docs, 2026-06): **the model work
runs in the provider's own cloud agent, on the user's subscription, dispatched
through GitHub — not via pay-per-token API keys and not in a looper-owned
runner.** Looper itself is pure orchestration: it manipulates GitHub state,
dispatches work to provider cloud agents, ingests the PRs they produce, and gates
them. It makes no direct model API calls on the primary path.

The adopter's job shifts from *manually prompting an agent* to *managing and
tuning loops*: dogfood the product, file tickets, set policy, act as escalation
authority. Looper does the SDLC labor using the subscriptions the team already
pays for.

### Who it's for

Maintainers and teams who already have Claude Code and/or Codex subscriptions and
want an autonomous contributor for the well-specified middle of their backlog,
with humans retained for taste, ambiguity, and high-blast-radius decisions.

### Design tenets

- **Subscription-native.** Primary execution is the provider's cloud agent on the
  user's Claude/Codex subscription. No required API keys, no per-token billing on
  the happy path. Auth starts with a **browser login via the CLI** (`looper
  login`); Claude additionally imports a per-routine `/fire` URL + bearer-token
  secret ref from the Claude web UI. This is a subscription routine token, not a
  Claude Platform API key or PAT.
- **Generic by default.** No assumptions about language, framework, cloud, or CI
  beyond "it's a GitHub repo." Specifics arrive through config and adapters.
- **Zero-infra to adopt.** The provider hosts the agent sandbox; looper's thin
  controller runs in the adopter's GitHub Actions (or via the CLI). Nothing
  looper-hosted to trust or pay for.
- **GitHub is the substrate _and_ the dispatch bus.** Issues, labels, PRs, and
  comments are the database, the message bus, the state machine — and the way
  looper triggers provider cloud agents.
- **Safe by default, autonomous by promotion.** New installs run dry-run /
  human-gated; autonomy is granted per risk tier as loops earn trust.
- **Everything-as-artifact.** Config, prompts/briefs, policies, and plans live in
  the repo, versioned and reviewable.

## Execution model: orchestrate provider cloud agents over GitHub

The single most important architectural fact. Looper splits cleanly:

- **Controller (looper code, deterministic):** triggering, claiming/locking,
  composing the task brief, **dispatching** to a provider cloud agent,
  **ingesting** the resulting PR, running gates, merge authority, budgets,
  retries. Runs cheaply in the adopter's Actions or from the CLI. No model calls.
- **Work cell (the provider's cloud agent):** clones the repo into the provider's
  sandbox, implements the change, **runs tests**, and opens a PR — on the user's
  subscription, in the provider's cloud. This is the "give the agent everything it
  needs to run tests and execute within the project" layer — and the provider
  owns that sandbox.

```
GitHub (substrate + dispatch bus)
   │  labels = state · issues/PRs = items · comments/mentions = dispatch
   ▼
looper controller  (Actions or CLI; deterministic; NO model calls)
   │  claim → compose brief → DISPATCH ───────────────┐
   │                                                   ▼
   │                            provider cloud agent (subscription)
   │                            • clones repo into provider sandbox
   │                            • runs build/tests (provider-hosted)
   │                            • opens a PR
   │  ◀──────────────── INGEST PR ─────────────────────┘
   ▼
gates: adopter's CI (required checks) · cross-provider review · deploy smoke
   ▼
merge (policy + risk tier)  →  durable plan updated in the repo
```

### Dispatch surfaces (verified, 2026-06; abstracted behind one backend interface)

| Provider | Subscription cloud feature | Unattended dispatch surface |
|---|---|---|
| **Claude** | "Claude Code on the web" sessions + **Routines** | Primary V1: imported routine **API `/fire`** URL + per-routine bearer token. Claude-native schedule/GitHub triggers exist, but are configured in Claude's web UI and are not Looper's primary dispatch path. |
| **Codex** | **Codex cloud** (per-task container) | **GitHub `@codex` mention / assignment only** — no REST API for cloud tasks; `@codex review` for reviews |

The backend contract normalizes these different subscription-native dispatch
surfaces: Claude is called by `/fire`, Codex by GitHub mention/assignment, and the
optional self-hosted runner by a local/API execution path. Looper hides those
differences behind one **execution-backend interface** so loops are written once
and run on either provider.

### The honest constraints (these shape V1)

- **Secrets for tests live in the _provider's_ cloud, not looper's.** "Everything
  it needs to run tests" = configuring the provider's sandbox (setup scripts +
  env vars). For Claude routines, that means the adopter configures the Claude
  cloud environment in Claude's web UI; Looper does **not** forward GitHub
  Actions secrets to Claude at `/fire` time. The adopter's code and those secrets
  reside in Anthropic/OpenAI infrastructure. That is the trust boundary, and it
  must be stated plainly.
- **Codex strips secrets before the agent phase and disables agent-phase internet
  by default.** Tests needing live credentials or network may not run inside
  Codex's agent phase. Looper therefore treats the **adopter's own GitHub Actions
  CI as the trustworthy verification gate** (ladder rung 2) regardless of where
  the work cell ran — the provider sandbox is for *producing* the change, not for
  *trusting* it.
- **Subscription rate limits, not just dollars.** Codex cloud is capped (~5
  tasks/hr on lower tiers); Claude routines have daily caps. Looper's budgeting
  must model quota/throughput, not only token cost.
- **No model API key on the primary path** means looper cannot make arbitrary
  model calls itself; *every* model-driven step (including grooming) is a
  dispatched provider-cloud task. Looper's own code stays deterministic.
- **ToS is an open question.** Whether a third-party tool may programmatically
  drive a user's subscription quota at scale is not squarely answered by either
  provider's public docs. Flagged as an adoption risk to verify, not assumed.
- **Exclusions:** orgs with Anthropic Zero-Data-Retention cannot use Claude cloud
  sessions/routines; such adopters need the optional self-hosted backend.

### Self-hosted / API backend (secondary — confirmed kept, 2026-06-08)

A confirmed, supported fallback — *not* the default. The adopter **self-hosts the
execution container** and brings **their own model API key** (Anthropic API /
Bedrock / Vertex, or OpenAI via `codex exec`). The work cell runs on the adopter's
own compute — a CI runner or a container/host they control — so this backend
**recovers exactly what the provider-cloud path gives up**: full access to live
secrets and network during the work cell, no provider rate caps, and Zero-Data-
Retention compatibility. It is the escape hatch for the three cases the
subscription path cannot serve (ZDR orgs, no subscription, tests needing live
secrets/network). Same loops, same `dispatch → ingest → gate` contract; only the
execution backend differs.

> **Decision (2026-06-08):** support both backends. Subscription/provider-cloud is
> the default and the product's reason to exist; the self-hosted/API backend is a
> first-class secondary kept for capability and reach, never the happy path.

## The operator interface: the CLI

Because the adopter's job is now *running the loops*, the **CLI is looper's
primary human surface** (not just `init`). It must answer, at a glance: what loops
exist, what each one runs, **how it's prompted**, **what its specific steps are**,
what ran recently, what it cost, and what's stuck — and let the operator trigger,
dry-run, tail, and tune loops. See Milestone 16. The CLI reads from the same three
sources of truth as everything else: GitHub state (live), the durable plan store
(history), and run telemetry (aggregate).

Two CLI capabilities matter most for first-touch and extensibility:

- **`looper login` — the keyless connector.** A browser login — GitHub OAuth
  **device flow** via a public OAuth-App *client_id* (no private key, no server to
  host), *or* simply reusing the user's existing `gh`/git auth — authenticates the
  user locally and connects the provider subscription, storing tokens in the OS
  keychain. No PAT to mint, no model API key to paste. Claude connect then walks
  the user through creating/editing a routine in Claude's web UI and importing the
  `/fire` URL + one-time bearer token as GitHub Actions secret refs. **In CI the
  controller needs no login at all — it uses the workflow's `GITHUB_TOKEN` plus
  those already-imported secret refs.** (Model API keys exist only on the optional
  self-hosted backend.)
- **`looper loops new` — author a custom loop** via a short questionnaire that
  generates a per-loop template file and shows you where to edit it (below).

## The state machine (GitHub as substrate)

Labels are states; loops are pure transitions. The scheme is configurable,
defaulting to:

```
new → needs-grooming → needs-clarification ⇄ ready-for-agent
    → in-progress → in-review → changes-requested ⇄ verified → merged → deployed
    (terminal off-ramps: blocked · needs-human · stuck · abandoned)
```

A loop queries items in one state, dispatches/advances them, and is otherwise
stateless. This is what makes providers interchangeable: Claude and Codex are just
GitHub-citizens whose cloud agents looper dispatches against the same labels.

### Triggering: events for latency, cron for resilience

Loops run on **two trigger modes**, and V1 ships both because neither alone is
robust:

- **Event-driven (GitHub webhooks)** — react immediately to concrete GitHub
  workflow events and actions: `issues` (`opened` / `edited` / item
  `labeled`), `issue_comment` (`created` / `edited`), `pull_request`
  (`opened` / `synchronize` / `closed` with `merged=true`), PR reviews, and CI
  completion via checks/status/workflow-run events. Low latency: grooming reacts
  to a new issue, clarification to a human reply, review to a new PR, deploy to a
  merged PR. Repository `label` events are only label-definition maintenance; item
  labels arrive through `issues.labeled` / `pull_request.labeled`.
- **Cron reconcile sweep** — a scheduled pass that scans the board for items in a
  given state and advances them. It is the **resilience backstop**: it recovers
  work a dropped/missed webhook would otherwise strand, drives **time-based
  transitions** (backoff re-attempts, stuck-detection escalation, quota-window
  resets), and makes the system eventually-consistent.

This is the standard control-plane pattern — *watch + periodic resync*: events
keep it responsive, the sweep keeps it correct. Because transitions are
idempotent and claims are atomic (M03), an event and a sweep racing on the same
item is safe.

**The `GITHUB_TOKEN` mechanic (why the sweep is load-bearing).** GitHub's default
`GITHUB_TOKEN` deliberately does **not** re-trigger workflows, so a state change
looper's controller writes (a label, a comment) won't fire the *next* loop's
event. **The cron sweep is exactly what carries those controller→controller
handoffs** — it picks the item up in its new state on the next tick. This is why
**no GitHub App is required** (V1): the sweep dissolves the recursion problem.
Handoffs that are *not* from `GITHUB_TOKEN` — a human's comment/label, or a
**provider** agent (Anthropic's/OpenAI's App) opening a PR — still fire their
event instantly, so only controller→controller steps run at sweep pace. Adopters
who want those instant too can drop a fine-grained PAT into a repo secret; a
looper GitHub App is a post-V1 option (see Identity & secrets), never a V1
requirement.

## Durable planning store (plans-as-memory)

Looper productizes a durable planning system (the milestones+tasks shape this repo
uses on itself). **Every body of work — a GitHub issue/epic — gets a milestone and
a task (or subtasks) written into the target repo:** grooming creates the plan,
the implementation work cell keeps it accurate, review/merge advances its
`Status`, and the issue **label mirrors the task `Status`**. The plan store is the
durable memory; GitHub is the control plane; they never disagree. Path and format
are configurable.

## Generic-ness, in three plugin systems

1. **Config.** A root `looper.yml` holds global defaults (label scheme, risk
   tiers, blast-radius limits, budgets/quota, **provider + execution backend**,
   plan-store location). Each loop is then its **own file** under
   `.looper/loops/<name>/` — never one monolithic config everything piles into.
2. **Project adapters.** A small `detect / build / test / lint / run / deploy`
   interface so looper can describe an arbitrary project to the work cell (and run
   verification in the adopter's CI). Auto-detection + a generic command escape
   hatch so no project is unsupported.
3. **Model providers / execution backends.** One worker contract satisfied by the
   Claude backend, the Codex backend, and the optional self-hosted backend.
   Selectable per loop (e.g. implement with one, review with another).

## The loops

Each is a deterministic controller wrapping a dispatched work cell:

- **Grooming & clarification** — raw issue → Definition-of-Ready + a durable plan
  + a posted plan-as-contract. Clarification is **event-triggered, never polled**;
  bias to *stating assumptions and proceeding*.
- **Implementation** — claim → compose brief → dispatch to the provider cloud
  agent → ingest its PR. Enforces blast-radius limits; scope-exceeding work halts
  and escalates.
- **Review, verification ladder & merge** — cross-provider review (e.g. dispatch
  `@codex review` on a Claude-authored PR, or a Claude routine on a Codex PR),
  intent-diff against acceptance criteria, fix-and-revalidate sub-loop, graduated
  auto-merge by risk tier.
- **Deploy & operational verification** — deploy via the project adapter on merge,
  smoke/canary + health checks, auto-rollback.

### Loops are declarative (one file per loop)

The four above are *built-in defaults*, not a closed set. **A loop is data, not
core code** — and each loop is its **own file**, never a stanza in one giant
`looper.yml`. A loop lives under `.looper/loops/<name>/` as a small `loop.yml`
(trigger, transition, backend, gates) plus a co-located `prompt.md` (its brief):

```
.looper/loops/dep-update/
├── loop.yml      # trigger, transition, backend, gates
└── prompt.md     # the versioned brief
```

```yaml
# .looper/loops/dep-update/loop.yml
name: dep-update
trigger: { cron: "weekly" }        # the only two trigger kinds: cron or github_event
transition: { from: scheduled, to: in-review }
backend: claude                     # subscription
gates: { require_ci: true, tier: safe }
blast_radius: { max_files: 5 }
```

Because the trigger space is small (**GitHub events + cron, nothing else**) and
the rest is a short set of choices, **`looper loops new` is a questionnaire, not a
syntax exercise**: it asks the few questions (trigger kind + which event/schedule,
from→to transition, backend, gates), then **generates the loop folder from a
template, prints its path, and tells the user to edit `prompt.md`**. It validates
the transition against the state machine (M03) and offers a dry-run. The generic
runner (M03) executes any declared loop. This is the fourth axis of looper's
genericity, alongside config, project adapters, and providers.

## The verification ladder (trust)

A loop that reviews, fixes, and merges its own lineage rubber-stamps. Each rung is
harder to fake than the last:

1. Work-cell self-test in the provider sandbox (weakest; may be limited by Codex
   secret-stripping / no-internet).
2. **CI the agent cannot edit away** — the *adopter's* required checks + branch
   protection + CODEOWNERS. The floor, and trustworthy *regardless of where the
   work cell ran*.
3. **Cross-provider adversarial review** — a different provider than the
   implementer.
4. **Deploy-time smoke/canary + health checks** → auto-rollback.
5. **Dogfooding** — the human.

Merge authority is gated on rungs 2–4. Ship with **graduated autonomy**:
human-gated by default; promote `tier:safe` to auto-merge as it earns trust; keep
`tier:core` human-gated via CODEOWNERS forever.

### How we know the request was satisfied

The ladder validates *correctness and safety*. Validating that the work satisfied
**what the user asked for** is a separate, harder question, and looper answers it
with one principle: **you cannot validate satisfaction until the request is
machine-checkable.** So validation is a chain that begins at grooming, not review:

1. **Define the target (grooming, M08).** A vague issue is groomed into explicit
   **acceptance criteria** + scope + a **test plan** (Definition-of-Ready). If the
   request is genuinely ambiguous, the loop asks rather than guesses. No
   acceptance criteria → nothing to validate against → the loop refuses to start
   (M03 DoR gate).
2. **Make it the contract (plan-as-contract, M08/M09).** The criteria are written
   into the durable plan and posted on the issue. Everything downstream is checked
   against *this*, not against the model's opinion of "good."
3. **Validate objectively where possible (rung 2).** Acceptance criteria are
   encoded as **executable acceptance tests** wherever they can be. Then "did it
   satisfy the request?" reduces, for those criteria, to "do the acceptance tests
   pass?" — checked by the adopter's CI, which the agent cannot edit. This is the
   strongest, least-fakeable form of intent validation.
4. **Judge the rest (intent-diff, M10·0043).** Criteria that can't be a test
   ("the error message is clear," "matches the existing API style") are checked by
   a **cross-provider reviewer** doing an *intent-diff*: does the PR deliver the
   plan + each acceptance criterion — not merely "does it compile." Unmet criteria
   route to the fix-and-revalidate sub-loop, not to merge.
5. **Gate the merge on it (DoD).** Merge requires **every acceptance criterion
   met + CI green + review approved + deploy smoke** (Definition-of-Done). The
   durable plan's criteria checklist is the auditable record of what was satisfied.
6. **Human backstop (rung 5).** Dogfooding catches the deepest failure: when the
   *criteria themselves* were wrong (the request was mis-groomed). That's why the
   human confirms acceptance criteria at grooming and stays the escalation
   authority — looper validates against the target, but a human owns the target.

The honest limit: steps 1–2 are load-bearing. If the acceptance criteria don't
capture the real intent, every downstream check validates the wrong thing
confidently. Looper's defense is to make the criteria explicit, testable, and
human-confirmable — so a wrong target is visible and fixable, not buried.

## Identity & secrets (two planes)

One rule: **looper never serializes a long-lived credential into prompts, plans,
comments, run records, or other GitHub/model-visible artifacts it controls.**
Project secrets may still reside in a provider cloud environment or a self-hosted
container when a backend needs them; that residency is explicit and gated.

**Looper's own repo identity** (to read/write labels, PRs, comments, claims) is
the Actions **`GITHUB_TOKEN`** — free, zero-setup, auto-scoped to the repo. The
loop-to-loop handoffs `GITHUB_TOKEN` won't re-trigger are carried by the cron
sweep (above), so **no looper GitHub App is required for V1** — an optional PAT
buys instant handoff, and a full looper App (a distinct `looper[bot]` identity,
org-wide install) is a deliberately post-V1 enhancement. The local CLI authenticates
the user via OAuth device flow (a public OAuth-App *client_id*, no hosted backend)
or the user's existing `gh`/git auth. This is separate from the two secret planes:

- **Provider auth plane** — the user's Claude/Codex **subscription**, exercised
  through the provider's validated repo-connect surface. For Claude V1, the user
  creates/edits the routine in Claude's web UI, selects the repo and cloud
  environment, adds an API trigger, and imports the `/fire` URL + per-routine
  bearer token as secret refs. For Codex, the user authorizes the provider's
  GitHub App. There is usually **no model API key** for looper to store.
- **Project-secret plane** — the secrets the work cell needs to build/test/deploy.
  On the primary path these are configured into the **provider's** cloud
  environment (for Claude, manually in Claude's cloud environment; for Codex,
  according to Codex's setup/env constraints); on the self-hosted backend they are
  injected into the adopter's own runner. Looper does not bridge GitHub Actions
  secrets into Claude at `/fire` time. Either way looper scrubs secrets from
  anything model-visible it controls, and documents the residency/trust boundary
  honestly (provider-cloud on the primary path).

## Observability, cost & safety

- **Budgets + quota awareness + a kill switch** checked before any dispatch (a
  label or repo variable; models both token cost *and* subscription rate caps).
- **Stuck detection:** after K failed attempts → `needs-human`, exponential
  backoff. Generalized into a tunable failure policy below (Resilience).
- **Run reporting** with no hosted UI: Actions job summaries, issue/PR comments,
  the CLI, and an optional dashboard. Per-provider outcome telemetry feeds routing.
- **Rollback as a first-class loop.**

## Authorization & trigger control

On a public repo, *anyone* can open an issue or comment — so without a gate, a
stranger could drive acting loops on the maintainer's subscription (quota drain +
injection vector). Looper adds an **authorization gate** evaluated in the runner's
pre-flight, before any claim/dispatch — the access-control sibling of budget and
the kill switch. Maintainers control **who / what / when** (M17):

- **Who** — an actor policy (`anyone` | `org-members` | `collaborators` |
  `allowlist`, plus allow/deny) over GitHub's `author_association`. Default
  `collaborators`; cron is the trusted "system" actor.
- **What** — per-loop allowed events and bot actors.
- **When** — per-actor + global trigger rate caps and optional schedule windows.

**Safe by default:** an untrusted trigger is *acknowledged but parked* —
`looper:needs-approval`, no dispatch, no spend — until a **trusted** human releases
it (`looper:approved` / `looper approve`; a self-approval by the untrusted actor
doesn't count). Parking untrusted content before it reaches an acting work cell
also shrinks the injection surface. Config is repo-wide and per-loop; the strictest
rule wins.

## Resilience & failure policy

Failure handling is a **classified, user-tunable policy** (M19), not a single
"K failures → needs-human." A taxonomy picks the response — `transient` (retry with
backoff), `terminal` (escalate), `poisoned` (item fails every attempt →
quarantine), `overload` (too much in flight → defer), `budget` (out of quota →
pause/park) — and maintainers tune the knobs (repo-wide + per-loop):

```yaml
resilience:
  retries: { max: 2, backoff: exponential, base: 30s, cap: 10m }
  dispatch_timeout: 30m
  max_attempts_per_item: 3            # exhausted → looper:quarantine
  max_in_flight: { global: 10, per_loop: 4 }
  circuit_breaker: { consecutive_failures: 5, cooldown: 1h }   # pause on provider outage
  on_failure: needs-human            # needs-human | retry | abandon
  escalate_to: "@team/maintainers"
```

A **circuit breaker** beats blind retries during a provider outage (pause, don't
burn quota); a load spike **defers** past `max_in_flight` rather than overrunning;
and nothing is silently dropped — an exhausted item lands in `looper:quarantine`
with its failure recorded and a human-releasable path (`looper retry`).

## V1 scope

**In:** attach via config + reusable Actions + CLI; the four loops running on
**Claude and Codex subscriptions** via their cloud agents, dispatched through
GitHub; the optional self-hosted/API backend; project adapters (auto-detect +
generic); durable plan store; verification ladder + risk-tiered graduated
auto-merge; two-plane secrets; budgets/quota/kill-switch/stuck-detection; a
**loop management & observability CLI**; docs + ≥1 real external dogfood repo;
semver `1.0.0`.

**Out (post-V1):** a hosted looper service / managed backend; non-GitHub forges;
a large adapter/provider marketplace; advanced ensemble/routing beyond the basics;
web analytics product.

**Non-negotiable for V1:** subscription path works end-to-end; human-gated by
default; secrets never in model-visible context looper controls; looper never able
to edit the checks that gate it; and the provider-cloud trust boundary stated
plainly to adopters.

## Verified provider capabilities (snapshot, 2026-06 — re-verify; features move fast)

- **Claude:** "Claude Code on the web" + "Routines" are subscription-only cloud
  agents. A routine can be triggered by an API `/fire` endpoint with a
  per-routine bearer token, schedule, or Claude-native GitHub PR/release trigger.
  API triggers/tokens are created in the Claude web UI; the CLI cannot currently
  create or revoke them. `/fire` is experimental, has no SDK/idempotency support,
  returns a session id/URL, and counts against routine/subscription limits.
  Routines run in Anthropic-managed cloud environments whose setup scripts, env
  vars, network access, repo access, and branch-push permissions are configured in
  Claude. ZDR orgs are excluded; the Claude GitHub Action is a separate
  API-key path using `ANTHROPIC_API_KEY`.
- **Codex:** "Codex cloud" is GA, subscription sign-in; per-task OpenAI container
  clones the repo, runs tests, opens PRs; **dispatched only via GitHub `@codex`
  mention/assignment** (no cloud REST API); setup + maintenance scripts and env
  vars, but **secrets stripped before the agent phase** and **agent-phase internet
  off by default**; cloud-task rate caps (~5/hr lower tiers).
- **Open ToS question (both):** programmatic third-party driving of a user's
  subscription quota is not clearly sanctioned by public docs — verify before
  depending on it.

## Roadmap

| # | Milestone | Layer |
|---:|---|---|
| 00 | Pre-Build Validation Spikes | Validation |
| 01 | Project Foundation & Open-Source Scaffolding | Foundation |
| 02 | Attachment & Configuration Model | Platform |
| 03 | GitHub State-Machine Core | Platform |
| 04 | Durable Planning Store | Platform |
| 05 | Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | Platform |
| 06 | Project Adapter System | Platform |
| 07 | Secrets & Identity (two-plane, subscription-native) | Platform |
| 08 | Grooming & Clarification Loop | Loops |
| 09 | Implementation Loop | Loops |
| 10 | Review, Verification Ladder & Merge Loop | Loops |
| 11 | Deploy & Operational Verification | Loops |
| 12 | Observability, Cost & Safety | Cross-cutting |
| 13 | Multi-Model Orchestration | Cross-cutting |
| 14 | Documentation, Examples & Trust | Release |
| 15 | V1 Hardening & Release | Release |
| 16 | Loop Control & Observability CLI | Operator |
| 17 | Authorization & Trigger Control | Hardening |
| 18 | Test & Simulation Harness | Hardening |
| 19 | Resilience & Failure Policy | Hardening |

Dependency order: **00 (validation spikes) gates everything** → 01 → 02 →
{03, 05, 06, 07} → 04 → 08 → 09 → 10 → 11; 12, 13, 16,
17, and 19 layer across the loops (17 and 19 are pre-flight gates in the runner);
18 (the test harness) is built alongside from the start; 14 and 15 finalize. Build
loops one at a time starting with grooming, and keep merge human-gated until the
verification ladder is proven on a real repo.

## The adopter's end-state job

Ticket quality · loop-prompt/policy tuning (via the CLI) · escalation target and
taste authority · and **owning the verification ladder and risk tiers** — the dial
that trades autonomy for safety, the one thing a loop must never tune about itself.
