# 0006 Config Schema & Validation

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Define and validate loopdog's config: a root `loopdog.yml` for global defaults plus
**one file per loop** under `.loopdog/loops/<name>/loop.yml`, with loop discovery
and clear validation errors.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md).
Config is the contract everything reads — the runner (M03), backends (M05), gates
(M03 · 0014), and the CLI (M16). One-file-per-loop avoids a monolithic
`loopdog.yml`. See [architecture](../../docs/architecture.md) "Generic-ness, in
three plugin systems."

## Scope

- Root `loopdog.yml` schema (global defaults).
- Per-loop `.loopdog/loops/<name>/loop.yml` schema + co-located `prompt.md`.
- Loop discovery (glob) and root-default → per-loop override precedence.
- A validator (`loopdog config validate`) with actionable errors.

### Technical detail

Root config:

```yaml
# .loopdog/loopdog.yml
version: 1
backends: { default: claude }         # default execution backend
plan_store: ".loopdog/plans"
sweep: { interval: "*/5 * * * *" }    # cron reconcile-sweep cadence (0076)
risk_tiers:
  safe: ["docs/**", "**/*.test.*"]
  core: ["src/auth/**", "migrations/**"]
budgets:                               # global spend ceiling (M12)
  window: monthly
  global: { max_dispatches: 0, max_usd: 0 }
  per_loop: { max_dispatches: 0, max_usd: 0 }
  on_exceeded: park                    # park | needs-human
kill_switch: { variable: LOOPDOG_KILL, label: "loopdog:kill" }   # top-level (M12)
quota: { window: monthly, on_exceeded: defer }   # subscription quota: defer | park
authorization: { actors: collaborators, on_unauthorized: park }   # M17 (per-loop overridable)
resilience: { retries: { max: 2 }, max_attempts_per_item: 3 }     # M19 (per-loop overridable)
adapter: auto                          # project adapter by name; default "auto" => auto-detect
defaults:                              # inherited by every loop unless overridden
  blast_radius: { max_files: 20, max_diff: 400 }
  mode: dry-run
```

Per-loop config (discovered via glob `.loopdog/loops/*/loop.yml`):

```yaml
# .loopdog/loops/<name>/loop.yml
name: <name>                          # must equal the folder
trigger:                              # exactly one kind
  github_event: pull_request          # event name from 0008's matrix
  action: [opened, synchronize]       # optional; validated against that event
  predicate: { merged: true }         # optional; e.g. pull_request.closed merge
  # — or —
  cron: "weekly"                      # hourly|daily|weekly|<cron expr>
  filter: { author: "dependabot[bot]", label: "…" }   # optional
transition: { from: <state>, to: <state> }   # must be a legal edge (0011)
backend: claude | codex | self-hosted        # optional; else root default
adapter: <name>                              # optional; project adapter by name; default "auto"
gates: { require_dor: true, require_ci: true, tier: safe, draft_pr: false, only: patch }
authorization: { actors: allowlist, allow: ["@dana"] }   # optional; tightens root (M17)
resilience: { max_in_flight: { per_loop: 2 }, max_fix_attempts: 2 }   # optional; overrides root (M19)
blast_radius: { max_files: 5 }               # optional; else root default
mode: dry-run | suggest | act
# brief is the sibling prompt.md
```

Validation rules: `name` matches folder; exactly one trigger kind; `github_event`,
`action`, and predicates validate against 0008's canonical event/action matrix
(`merge` is encoded as `pull_request.closed` + `predicate.merged: true`; item
labeling is `issues.labeled` / `pull_request.labeled`, not top-level `label`);
`transition` is a legal edge (delegates to 0011); referenced `backend` is
connected; `tier`/states exist; `prompt.md` present; `authorization`/`resilience`
blocks validate against the M17/M19 schemas. Precedence: per-loop value > root
`defaults` > built-in default. Errors are per-field with file+path context.

## Out Of Scope

- The transition-legality table itself (0011); the questionnaire that writes these
  files (M16 · 0078); secret backends (M07).

## Acceptance Criteria

- [x] Documented schemas for root `loopdog.yml` and per-loop `loop.yml`.
- [x] Loops are discovered by glob; each is self-contained in its folder.
- [x] Root `defaults` are inherited and per-loop values override them.
- [x] `github_event` + `action` + predicates are validated against 0008's
      event/action matrix, including the `pull_request.closed` merge predicate and
      item-label-vs-label-definition distinction.
- [x] `loopdog config validate` reports per-field errors with file + path; an
      invalid trigger/transition/backend/tier fails validation.
- [x] No loop config is read from a single monolithic file.

## Implementation Checklist

- [x] Define the root + per-loop schemas (e.g. JSON Schema) and types.
- [x] Implement discovery + the default→override merge.
- [x] Implement the validator with actionable errors.
- [x] Wire validation into `loopdog init`, `loopdog loops validate`, and CI.

## Test Plan

```bash
# replace with the chosen stack's runner
# loopdog config validate on a fixture tree (valid + each invalid case)
# invalid event/action combos fail: label.labeled, pull_request.closed without an explicit merge predicate for deploy, unsupported push
```

## Verification Log

- 2026-06-09: config suite green (7 tests): good-tree resolution with default
  merge + per-loop override; matrix rejections (label.labeled, push); illegal
  transition with table reason; declares extension; folder-name/prompt/one-trigger
  rules; cron validation; missing-root fail-closed.
- 2026-06-09: `loopdog config validate` exercised end-to-end on a scaffolded
  temp repo — per-field errors with file+path; warnings non-fatal.

## Decisions

- Schema mechanism: **zod (code-first)** in `@loopdog/config` (`schema/root.ts`,
  `schema/loop.ts`) — typed inference into core's `LoopDefinition`, defaults in
  one place; no separate JSON Schema files to drift.
- Precedence implemented as specced: per-loop > root `defaults` > built-in
  zod defaults, with `mergeDefined` so an absent per-loop key never clobbers.
- The 0008 event/action matrix lives in **`@loopdog/core`**
  (`transitions/event-matrix.ts`) — config may not depend on github, and core
  is the shared domain; github's parser and config's validator both import it
  (single source, no drift).
- Schema additions beyond the spec'd field set, recorded here: `expects:`
  (pull-request|comment|plan-update|none — the runner's work-cell contract),
  `review_backend:`, `serialize_by:` (0013), `declares:` (custom states/edges,
  0011), `gates.required_checks`. All optional with safe defaults.
- Cron support is deliberately minimal (hourly/daily/weekly, */N, fixed daily/
  weekly times); exotic expressions fail validation with guidance. Avoids a
  cron-parser dependency in the published CLI.

## Risks / Rollback

Schema churn ripples to every consumer; version the config (`version:`) and keep
an upgrade path (M15 · 0067). Fail validation closed.

## Final Summary

`@loopdog/config` discovers (`.loopdog/loopdog.yml` + one folder per loop —
never a monolith), zod-validates both schemas, cross-validates against the
core event matrix + transition table (+ cron, prompt presence, folder-name,
duplicates, one-trigger-kind), and resolves into core `LoopDefinition`s with
documented precedence. Per-field errors carry file+path. Exposed as
`loadConfig()` and `loopdog config validate`.
