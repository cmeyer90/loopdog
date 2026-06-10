# 0006 Config Schema & Validation

Status: planned  
Branch: task/0006-config-schema-and-validation

## Goal

Define and validate looper's config: a root `looper.yml` for global defaults plus
**one file per loop** under `.looper/loops/<name>/loop.yml`, with loop discovery
and clear validation errors.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md).
Config is the contract everything reads — the runner (M03), backends (M05), gates
(M03 · 0014), and the CLI (M16). One-file-per-loop avoids a monolithic
`looper.yml`. See [architecture](../../docs/architecture.md) "Generic-ness, in
three plugin systems."

## Scope

- Root `looper.yml` schema (global defaults).
- Per-loop `.looper/loops/<name>/loop.yml` schema + co-located `prompt.md`.
- Loop discovery (glob) and root-default → per-loop override precedence.
- A validator (`looper config validate`) with actionable errors.

### Technical detail

Root config:

```yaml
# .looper/looper.yml
version: 1
backends: { default: claude }         # default execution backend
plan_store: ".looper/plans"
sweep: { interval: "*/5 * * * *" }    # cron reconcile-sweep cadence (0076)
risk_tiers:
  safe: ["docs/**", "**/*.test.*"]
  core: ["src/auth/**", "migrations/**"]
budgets:                               # global spend ceiling (M12)
  window: monthly
  global: { max_dispatches: 0, max_usd: 0 }
  per_loop: { max_dispatches: 0, max_usd: 0 }
  on_exceeded: park                    # park | needs-human
kill_switch: { variable: LOOPER_KILL, label: "looper:kill" }   # top-level (M12)
quota: { window: monthly, on_exceeded: defer }   # subscription quota: defer | park
authorization: { actors: collaborators, on_unauthorized: park }   # M17 (per-loop overridable)
resilience: { retries: { max: 2 }, max_attempts_per_item: 3 }     # M19 (per-loop overridable)
adapter: auto                          # project adapter by name; default "auto" => auto-detect
defaults:                              # inherited by every loop unless overridden
  blast_radius: { max_files: 20, max_diff: 400 }
  mode: dry-run
```

Per-loop config (discovered via glob `.looper/loops/*/loop.yml`):

```yaml
# .looper/loops/<name>/loop.yml
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

- [ ] Documented schemas for root `looper.yml` and per-loop `loop.yml`.
- [ ] Loops are discovered by glob; each is self-contained in its folder.
- [ ] Root `defaults` are inherited and per-loop values override them.
- [ ] `github_event` + `action` + predicates are validated against 0008's
      event/action matrix, including the `pull_request.closed` merge predicate and
      item-label-vs-label-definition distinction.
- [ ] `looper config validate` reports per-field errors with file + path; an
      invalid trigger/transition/backend/tier fails validation.
- [ ] No loop config is read from a single monolithic file.

## Implementation Checklist

- [ ] Define the root + per-loop schemas (e.g. JSON Schema) and types.
- [ ] Implement discovery + the default→override merge.
- [ ] Implement the validator with actionable errors.
- [ ] Wire validation into `looper init`, `looper loops validate`, and CI.

## Test Plan

```bash
# replace with the chosen stack's runner
# looper config validate on a fixture tree (valid + each invalid case)
# invalid event/action combos fail: label.labeled, pull_request.closed without an explicit merge predicate for deploy, unsupported push
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the schema mechanism (JSON Schema vs. code), the merge/precedence rules,
the exact gate/trigger field sets, and how 0008's event/action matrix is imported
or mirrored without drift.

## Risks / Rollback

Schema churn ripples to every consumer; version the config (`version:`) and keep
an upgrade path (M15 · 0067). Fail validation closed.

## Final Summary

Fill this in before marking verified.
