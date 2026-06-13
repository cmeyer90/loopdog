# Config Reference

Looper is configured by a root `.looper/looper.yml` (global defaults) and a
per-loop `.looper/loops/<name>/loop.yml`. Both are validated by the
`@looper/config` schema (`looper init` scaffolds valid defaults; `looper`
commands re-validate on every edit). This page documents **every** field; the
schema is the source of truth (`packages/config/src/schema/`).

> No field here references a Looper GitHub App, a model API key on the primary
> path, or a database/queue — by design. The only key-holding path is the opt-in
> `backends.self_hosted` escape hatch.

## Precedence

A per-loop `loop.yml` **overrides** the root default field-by-field. For the
resilience safety caps (attempts, in-flight, retries, breaker threshold) the
merge is **strictest-wins** — a loop may only be made *safer*, never laxer.
Authorization merges strictest-wins too (a loop can tighten WHO/WHAT/WHEN, never
loosen it).

## Root `looper.yml`

| Field | Type | Default | Notes |
|---|---|---|---|
| `version` | `1` | — (required) | schema version |
| `backends.default` | `claude \| codex \| self-hosted` | `claude` | default execution backend |
| `backends.review` | same | — | reviewer backend (cross-provider review, M13) |
| `backends.zdr` | bool | `false` | Zero-Data-Retention org → Claude cloud routines excluded |
| `backends.self_hosted.agent` | `claude \| codex` | `claude` | agent the self-hosted runner runs |
| `backends.self_hosted.api_key_secret` | string | `LOOPER_MODEL_API_KEY` | Actions secret name (self-hosted only — the one key-holding path) |
| `plan_store` | string \| `{ path, format_version }` | `.looper/plans`, fmt 1 | durable plan location (a string is shorthand for `path`) |
| `sweep.interval` | cron string | `*/5 * * * *` | reconcile cadence |
| `sweep.max_candidates_per_tick` | int ≥1 | `20` | global per-tick cap |
| `sweep.max_candidates_per_state` | int ≥1 | `10` | per-state cap |
| `risk_tiers.safe` / `.core` | string[] | `[]` | label/path globs that pin an item's tier |
| `budgets.window` | `daily \| weekly \| monthly` | `monthly` | spend window |
| `budgets.global` / `.per_loop` | `{ max_dispatches, max_usd }` | `0` (unlimited) | `0` = no ceiling |
| `budgets.on_exceeded` | `park \| needs-human` | `park` | what a budget breach does |
| `kill_switch.variable` | string | `LOOPER_KILL` | repo variable that halts all dispatch |
| `kill_switch.label` | string | `looper:stop` | per-item halt label |
| `quota.window` | `daily \| weekly \| monthly` | `monthly` | subscription-quota window |
| `quota.on_exceeded` | `defer \| park` | `defer` | throttle vs hold |
| `quota.backends.<id>` | `{ window?, max_dispatches? }` | — | per-backend cap override (raise for higher tiers) |
| `routing.mode` | `static \| outcome` | `static` | model routing (M13) |
| `routing.prefer` | `quality \| cost \| balanced` | `balanced` | routing bias |
| `routing.min_samples` | int ≥1 | `5` | samples before outcome routing kicks in |
| `routing.pin` | `{ <loop>: backend }` | — | force a loop's backend |
| `review_policy.never_same_as_implementer` | bool | `true` | cross-provider review guarantee |
| `review_policy.by_tier.{safe,default,core}` | backend | — | reviewer per risk tier |
| `authorization.*` | see below | safe defaults | WHO/WHAT/WHEN trigger control (M17) |
| `resilience.*` | see [Resilience](resilience.md) | safe defaults | failure policy knobs (M19) |
| `adapter` | string | `auto` | project adapter (`auto` = detect node/python/generic) |
| `adapter_options.*` | object | — | package manager / runner / command overrides + detect tuning |
| `work_cell.setup` | string | — | shell to prepare the work cell |
| `work_cell.env.<NAME>` | `{ value \| from_env \| from_actions_secret \| provider_configured, sensitivity }` | `sensitivity: build` | project env (exactly one source; `sensitive` is stripped before the agent phase on Codex) |
| `work_cell.backends.<id>` | `{ setup?, env? }` | — | per-backend work-cell overrides |
| `secrets.store` | `actions \| oidc \| vault \| doppler` | `actions` | secret backend |
| `secrets.inject[]` | `{ name, from?, key? }` | `[]` | secrets to resolve into the work cell |
| `defaults.blast_radius.max_files` | int ≥1 | `20` | per-run file ceiling |
| `defaults.blast_radius.max_diff` | int ≥1 | `400` | per-run changed-line ceiling |
| `defaults.mode` | `dry-run \| suggest \| act` | `dry-run` | **safe by default** — observe + explain |

### `authorization` (root + per-loop, strictest-wins)

| Field | Type | Default | Notes |
|---|---|---|---|
| `actors` | `anyone \| org-members \| collaborators \| allowlist` | `collaborators` | WHO may trigger acting loops |
| `allow` / `deny` | string[] | `[]` | allowlist / denylist (deny wins) |
| `on_unauthorized` | `park \| ignore \| comment` | `park` | untrusted trigger → needs-approval (park), drop, or comment |
| `approval_label` | string | `looper:approved` | a trusted collaborator applies this to release a parked item |
| `allowed_bots` | string[] | `[]` | bots need explicit allow |
| `trigger_sources` | string[] | — | WHAT: extra event selectors the loop acts on |
| `bots.allow` / `.deny` | string[] | `[]` | per-loop bot allow/deny |
| `rate_limit.per_actor_per_day` / `.global_per_hour` | int ≥1 | — | WHEN: trigger rate caps |
| `schedule_window.{days,hours,tz}` | — | — | WHEN: confine firing to a window (UTC-evaluated) |

## Per-loop `loop.yml`

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | kebab-case string | — (required) | loop name (**need not** equal the folder) |
| `trigger` | object | — (required) | **exactly one** of `github_event` or `cron` |
| `trigger.github_event` | string | — | e.g. `issues`, `pull_request` (validated vs the event matrix) |
| `trigger.action` | string \| string[] | — | event actions (e.g. `[labeled, opened]`) — `github_event` only |
| `trigger.predicate` | object | — | e.g. `{ merged: true }` — `github_event` only |
| `trigger.cron` | `hourly\|daily\|weekly\|<cron>` | — | cron loops (no `action`/`predicate`) |
| `trigger.filter.{author,label}` | string | — | narrow the trigger |
| `transition.from` / `.to` | string | — (required) | the state edge this loop drives |
| `transition.fallback` | string | — | where a failed verdict routes |
| `backend` | `claude \| codex \| self-hosted` | root default | execution backend |
| `review_backend` | same | — | reviewer backend for review loops |
| `adapter` | string | root default | override the project adapter |
| `expects` | `pull-request \| comment \| plan-update \| none` | `none` | what the work cell produces (`none` = deterministic transition, no work cell) |
| `gates.require_dor` | bool | `true` | enforce Definition-of-Ready before dispatch |
| `gates.require_ci` | bool | `true` | require CI green (Definition-of-Done) |
| `gates.tier` | `safe \| default \| core` | `default` | risk tier — **`core` never auto-merges** |
| `gates.draft_pr` | bool | `false` | open the PR as a draft |
| `gates.only` | string | — | restrict to matching paths |
| `gates.required_checks` | string[] | — | named checks that gate the landing state |
| `authorization` | partial of root `authorization` | — | per-loop tightening |
| `resilience` | partial of root `resilience` | — | per-loop tightening (strictest-wins) |
| `blast_radius.{max_files,max_diff,forbidden_paths}` | — | root default | per-loop blast radius |
| `serialize_by` | string | — | same-area serialization key |
| `requires.{live_secrets,network}` | bool | — | work-cell needs, checked vs backend capabilities |
| `ensemble.{enabled,judge}` | — | `false` | dual-attempt + judge (expensive; `tier:core` only) |
| `mode` | `dry-run \| suggest \| act` | root default | per-loop mode (promote with `looper promote`) |
| `declares.states` / `.edges` | — | `[]` | custom states/edges this loop adds to the state machine |

## Validator behavior on edge cases

| Config | Result |
|---|---|
| both `github_event` and `cron` in a trigger | **error**: "exactly one trigger kind required" |
| `action`/`predicate` on a `cron` trigger | **error**: those apply to `github_event` only |
| loop `name` ≠ its folder | **valid** (the `name` field is authoritative) |
| a `transition` edge not in the table (and not `declares`d) | **error** at load (illegal transition) |
| `backend` set to one not connected | **error** at run (capability/identity check) |
| an unknown top-level key | **error** (schema is closed) |
| `budgets.global.max_usd: 0` | **valid** — `0` means *unlimited*, not "block everything" |
| `defaults.mode: act` | **valid** — but you've removed the safe default; promote deliberately |

## See also

- [Resilience & Failure Policy](resilience.md) — the full `resilience:` block.
- [Security & Trust](security.md) — what each control guarantees.
- [Authoring guides](guides/adapters.md) — adapters + providers.
