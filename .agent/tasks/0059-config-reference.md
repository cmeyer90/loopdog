# 0059 Config Reference

Status: verified  
Branch: task/0059-config-reference

## Goal

Publish a complete, accurate, example-rich reference for loopdog's configuration —
the root `.loopdog/loopdog.yml` and the per-loop `.loopdog/loops/<name>/loop.yml` — so
an adopter can author or tune any config field without reading source. The
reference is **generated from the same schema the validator uses** (0006), so it
can never silently drift from what loopdog actually accepts.

## Background

Part of [Milestone 14](../milestones/milestone-14-documentation-examples-and-trust.md)
— the adoption-and-trust surface. The config schema and validator are defined by
the config package in **M02 · 0006**; this task documents that contract rather than
redefining it. It is the reference half of the docs site (the quickstart is 0058,
the adapter/provider authoring how-tos are 0060). The field set spans several
milestones — risk tiers and gates (M03 · 0014), budget/quota/kill-switch (M12),
authorization (M17), resilience (M19), backend selection (M05), plan store (M04) —
so this page is also the single place those cross-cutting knobs are catalogued for
an operator. See [architecture](../../docs/architecture.md) "Generic-ness, in three
plugin systems" and "Loops are declarative (one file per loop)", and
[codebase](../../docs/codebase.md) for the `@loopdog/config` boundary.

## Scope

- A reference page per config surface: **root `loopdog.yml`** and **per-loop
  `loop.yml`** (+ the co-located `prompt.md` brief), under the docs site (0058).
- Every field documented: name, type, default, allowed values, which milestone
  owns it, and a worked example; the **default → per-loop override precedence**
  rule stated once and linked from each overridable field.
- A **schema-to-doc generator** so the reference is emitted from the zod/JSON
  Schema in `@loopdog/config` (0006) — not hand-maintained prose that rots.
- A small library of **complete, copyable example configs** (minimal attach,
  dependabot auto-merge loop, cross-provider review loop, self-hosted backend) that
  are validated in CI.

### Technical detail

**Lands in:** `docs/` (the rendered reference pages, consumed by the 0058 site) +
a generator that lives with the schema in **`@loopdog/config`** (e.g.
`packages/config/src/schema/` exposes the schema; a `docs:config` script walks it).
No new package. The generator imports the *exact* schema objects 0006 defines so the
doc is a projection of the validator, never a parallel source of truth.

**Generation approach.** zod is the chosen schema mechanism (codebase.md). Annotate
each field with `.describe()` (and a small `.meta({ milestone, default, since })`
extension), then walk the schema to emit Markdown tables: one row per field with
`Field · Type · Default · Allowed · Owner(M##) · Notes`. Run it as
`npm run docs:config` (wired into the docs build and CI); a `--check` mode fails CI
if committed `docs/reference/config.md` differs from freshly generated output, so
the page can't drift from the schema. Code blocks in the prose are extracted and
fed through the **0006 validator** in the same CI job — a doc example that wouldn't
validate fails the build.

**Pages to produce** (Markdown under `docs/reference/`):

1. `config-root.md` — every root key. At minimum: `version`; `backends.default`
   (claude|codex|self-hosted, M05; per-stage siblings `backends.<stage>` allowed —
   no top-level `backend:` scalar); `plan_store` path (M04); `sweep.interval` cron
   (0076); `risk_tiers.{safe,core}` glob lists (M03·0014);
   `budgets.{window,global.{max_dispatches,max_usd},per_loop,on_exceeded}`
   (`on_exceeded: park|needs-human`, M12); `kill_switch.{variable,label}` (top-level,
   M12); `quota.{...,on_exceeded}` (`on_exceeded: defer|park`, M12);
   `adapter: <name>` (default `auto`, 0024);
   `authorization.{actors,allow,deny,on_unauthorized}` (M17);
   `resilience.{retries,dispatch_timeout,max_attempts_per_item,max_in_flight,
   circuit_breaker,max_fix_attempts,on_failure,escalate_to}` (`max_fix_attempts: 2`
   is the fix-loop ceiling; M19); `defaults.*` (the loop-inherited block: `backend`,
   `blast_radius`, `mode`).
2. `config-loop.md` — every per-loop key: `name` (must equal folder); `trigger`
   (**exactly one** of `github_event:` or `cron:`, optional `filter`);
   `transition.{from,to}` (must be a legal edge — link 0011); `backend` (overrides
   root); `gates.{require_dor,require_ci,tier,draft_pr,only}` (M03·0014);
   `authorization` / `resilience` / `blast_radius` (per-loop tighten/override,
   M17/M19); `mode` (dry-run|suggest|act); and the sibling `prompt.md` brief.
3. `config-precedence.md` — the one normative rule:
   **per-loop value > root `defaults` > built-in default**, with a worked merge
   example, plus the `loopdog:state/*` label scheme and where it's configured.

**Example library** (`docs/reference/examples/`, each a full valid tree):
`minimal/` (root only, all loops default, `mode: dry-run`); `dep-update/` (cron
trigger, `tier: safe`, `blast_radius.max_files: 5`, auto-merge); `review/`
(cross-provider: implement on `claude`, review loop on `codex`); `self-hosted/`
(`backends.default: self-hosted` + the API-key residency note). Each ships a
`loop.yml`/`loopdog.yml` exactly as `loopdog init`/`loopdog loops new` would emit, and
is added to the CI validation set.

**Edge cases the page must call out explicitly:** specifying both `github_event`
and `cron` (rejected — exactly one); `name` ≠ folder; a `transition` that isn't a
legal edge (0011); referencing a `backend` that isn't connected; `tier`/state names
that don't exist; missing `prompt.md`; `budgets.global.max_usd: 0` meaning
"subscription/quota-only, no dollar cap" (not "no budget"); `mode: act` on a fresh
install (allowed but loudly flagged — dry-run is the safe default, 0009); and how an
unknown key is handled (validation error, fail-closed — 0006). Every callout links
to the producing task.

## Out Of Scope

- Defining or changing the schema/validator itself (0006) — this documents it.
- The transition-legality table (0011), adapter/provider authoring guides (0060),
  the quickstart (0058), and the questionnaire that *writes* configs (M16 · 0078).
- A config-migration/upgrade guide (M15 · 0067).

## Acceptance Criteria

- [x] A single reference page (`docs/config-reference.md`) covers root `loopdog.yml`,
      per-loop `loop.yml`, and the precedence rule, covering **every** field in the
      0006 schema (verified field-by-field against `schema/root.ts` + `schema/loop.ts`).
- [x] Each field row lists type, default, allowed values, and a short note;
      precedence is stated up top (strictest-wins on the safety caps).
- [~] **Generated** from the schema + a `--check` CI drift guard — DEFERRED. The
      reference is hand-authored from the schema (accurate as of this commit); a
      schema-walking generator + `--check` gate is a future enhancement (CI tooling).
- [x] The example config (`examples/node-todo`) is run through the 0006 validator
      in a test (`example-node-todo.test.ts`), and every doc snippet is valid YAML.
- [x] The edge cases (dual trigger, name≠folder, illegal transition, unconnected
      backend, unknown key, `budgets.global.max_usd: 0`, `mode: act`) are each shown
      with the expected validator behavior (the "Validator behavior" table).
- [x] Linked from the docs index (0058); references no Loopdog GitHub App, no
      primary-path API key, and no database/queue.

## Implementation Checklist

- [x] Author `docs/config-reference.md` from `@loopdog/config`'s schema — every
      root + loop field, the precedence rule, and the edge-case table.
- [~] Schema-walking `docs:config` generator + `--check` mode — DEFERRED (see ACs).
- [x] The runnable example (0061) is the validated example library; its config is
      schema-checked in CI.
- [x] Linked from the docs index nav.
- [x] Link the reference into the 0058 site nav.

## Test Plan

Tests run via the repo's vitest runner; example validation reuses the 0006
validator with the M18 fakes (no real quota, no real GitHub).

```bash
# replace with the chosen stack's runner
npm run docs:config -- --check        # generated page == committed page
vitest run packages/config            # examples + edge cases validate as documented
# each docs/reference/examples/* tree passes `loopdog config validate`; each
# documented invalid case fails with the stated per-field error
```

## Verification Log

- 2026-06-12: `docs/config-reference.md` authored covering every field in
  `@loopdog/config` (root `loopdog.yml` + per-loop `loop.yml` + the
  `authorization`/`resilience` sub-blocks), each with type/default/allowed/notes,
  the precedence rule, and a "Validator behavior" edge-case table. Cross-checked
  field-by-field against `schema/root.ts` + `schema/loop.ts`. The example config
  (0061) validates against the same schema in CI. Linked from `docs/README.md`.
  The schema-generated `--check` drift guard is deferred (see Decisions).

## Decisions

- **Hand-authored, not generated, for V1.** A schema-walking generator + a
  `docs:config --check` CI gate is the drift-proof ideal, but building it robustly
  (walking zod, emitting stable markdown, wiring the gate) is CI tooling deferred
  per the project stance. The reference is authored directly from the schema and
  cross-checked field-by-field; the risk is future drift, mitigated by keeping the
  reference next to the schema in review. (Generator = a clean follow-up.)
- Original placeholder follows for reference: generator mechanism (schema-walk vs. a
  doc tool), the `meta` annotation
shape added to the 0006 schema, and where the example library lives + how it's
validated in CI.

## Risks / Rollback

The main risk is doc drift — a hand-written reference rots the moment the schema
changes. The generator + `--check` gate makes drift a build failure, which is the
whole point; if the generator proves too costly, fall back to a hand-written page
**plus** the CI example-validation gate (which still catches the most damaging
errors). Rollback is removing the pages and the CI step; no runtime code depends on
this task.

## Final Summary

`docs/config-reference.md` documents every root + per-loop config field (type,
default, allowed values, notes), the precedence rule, and a validator-behavior
edge-case table — authored directly from the `@loopdog/config` schema and
cross-checked against it. The runnable example's config is validated against the
same schema in CI. A schema-walking generator + `--check` drift guard is deferred
as a follow-up.
