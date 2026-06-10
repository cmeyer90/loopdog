# 0007 `looper init` CLI & Scaffolding

Status: planned  
Branch: task/0007-init-cli-and-scaffolding

## Goal

A `looper init` command that attaches looper to a fresh GitHub repo: it scaffolds
the root `looper.yml`, the built-in loop folders, and the thin reusable-workflow
callers from `templates/`, then previews exactly what looper would do — writing
nothing without confirmation, and safe-by-default (dry-run) once written.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md);
the first thing an adopter runs after `looper login` (0077). It turns the config
schema (0006) into real files on disk and wires the event (0008) and sweep (0076)
triggers into the adopter's Actions. The command lands in `@looper/cli`
(`commands/init.ts`), copies assets from the repo-root `templates/` tree, and
calls `@looper/config` to validate what it wrote. See
[codebase.md](../../docs/codebase.md) "Filetree" (the `templates/` tree + the
`cli` package) and [architecture.md](../../docs/architecture.md) "Generic-ness, in
three plugin systems" + "Safe by default, autonomous by promotion."

## Scope

- Scaffold config + built-in loops + workflow callers into the target repo from
  `templates/`, with detect-driven, zero-config defaults that work on a plain repo.
- A preview/plan step that prints the planned writes and the loops looper would run
  (states, transitions, triggers, backend, mode) **before** touching the disk.
- A `--dry-run` flag that previews only (no writes); idempotent re-runs that never
  clobber adopter edits.
- Validate the scaffolded tree (delegates to 0006) and print next steps.

### Technical detail

Lands in `@looper/cli` as `commands/init.ts`, registered on the `commander`
program; interactive prompts use `@clack/prompts`. Asset source is the repo-root
`templates/` tree (shipped in the published package): `templates/looper.yml`,
`templates/loops/<builtin>/{loop.yml,prompt.md}`,
`templates/workflows/looper-*.yml`.

Flow (composable, each step pure where possible):

1. **Detect** — call `@looper/adapters` `detect()` (M06) to identify the project
   (node/python/generic) and seed defaults (backend stays the root default
   `claude`; plan store `.looper/plans`). No network; read-only on the repo.
2. **Plan** — build a `ScaffoldPlan`: the list of files to write
   (`{ path, source, action: create|skip|conflict }`) plus a human summary of the
   resulting loops (name, `from→to`, trigger, backend, `mode`). A file that
   already exists with adopter edits → `conflict` (never overwritten); an
   unchanged prior scaffold → `skip` (idempotent).
3. **Preview** — render the plan: the file table and a per-loop summary
   (mirrors `looper loops list` shape) so the operator sees behavior before any
   write. `--dry-run` stops here with exit 0 and writes nothing.
4. **Confirm + write** — on confirmation, copy assets, creating
   `.looper/looper.yml`, `.looper/loops/<builtin>/…`, and
   `.github/workflows/looper-events.yml` + `looper-sweep.yml` (callers that
   `uses:` looper's versioned reusable workflows from 0008/0076, not copied logic).
5. **Validate** — run `@looper/config` validation (0006) on the written tree;
   fail closed with per-field errors if anything is malformed.
6. **Next steps** — print the follow-ups: confirm provider connect (0010), open a
   test issue, and how to promote `mode: dry-run → act` per risk tier.

Scaffolded root `looper.yml` ships **`defaults.mode: dry-run`** (the safe default,
0009) so a fresh install acts comment-only until promoted. Built-in loops copied:
the four defaults (groom/implement/review/deploy) as `templates/loops/*` assets —
init copies, it does not author (authoring is `looper loops new`, M16 · 0078).

Flags: `--dry-run` (preview only), `--force` (re-scaffold, still never silently
overwriting a `conflict` — prompts per file), `--yes` (non-interactive, accept
defaults; for CI/scripted setup), `--path <dir>` (target repo root, default cwd).

Edge cases: not a git repo / no `origin` remote → warn but allow (workflows still
valid); pre-existing `.looper/` → enter merge mode (skip unchanged, prompt on
conflict, never destroy); `templates/` missing from the install → hard error
(packaging bug); partial write interrupted → re-run is idempotent and resumes.

## Out Of Scope

- The config schema/validator itself (0006); the reusable workflows' internals
  (events 0008, sweep 0076); `looper login` + provider connect (0077, 0010); the
  loop questionnaire / `looper loops new` (M16 · 0078); the dry-run runtime
  behavior (0009 — init only sets the default).

## Acceptance Criteria

- [ ] `looper init` on a fresh repo scaffolds a working attachment: root
      `looper.yml`, the built-in loop folders, and the event + sweep workflow
      callers, all passing 0006 validation.
- [ ] Scaffolded config defaults to `mode: dry-run` (safe by default, 0009).
- [ ] A preview lists every planned write and a per-loop behavior summary
      (state, transition, trigger, backend, mode) before anything is written.
- [ ] `looper init --dry-run` writes nothing and exits 0.
- [ ] Re-running on an already-attached repo is idempotent: unchanged files are
      skipped and adopter-edited files are never silently overwritten.
- [ ] Detected project type (node/python/generic) seeds correct defaults.
- [ ] Workflow callers `uses:` looper's versioned reusable workflows (referenced,
      not copy-pasted).

## Implementation Checklist

- [ ] Add `commands/init.ts` to `@looper/cli` and register it on the program.
- [ ] Implement the `ScaffoldPlan` builder (detect → plan, with create/skip/conflict).
- [ ] Implement the preview renderer (file table + per-loop summary) and `--dry-run`.
- [ ] Implement the asset copier from `templates/` with idempotent merge + conflict prompts.
- [ ] Call `@looper/config` validation on the written tree; fail closed.
- [ ] Print next-steps guidance (connect 0010, test issue, promote to `act`).
- [ ] Document `looper init` in the CLI docs.

## Test Plan

Tests run via the repo's vitest runner; filesystem effects exercised against a
temp dir, GitHub/provider effects via the M18 fakes (no real quota, no network).

```bash
# replace with the chosen stack's runner
# init on empty temp dir → expected tree written + 0006 validation passes
# init --dry-run → no files written, preview lists planned writes + loop summary
# re-run on scaffolded tree → skips unchanged, never overwrites an edited file
# detect node vs python vs generic → correct defaults in scaffolded looper.yml
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the `templates/` packaging/resolution mechanism, the create/skip/conflict
merge policy, the exact built-in loop set scaffolded, and the preview format.

## Risks / Rollback

Clobbering adopter edits on re-run is the main risk — the conflict-not-overwrite
policy + idempotent skip defend it; `--dry-run` lets adopters inspect first.
Rollback is trivial: the scaffold is plain files in the adopter's repo, revertible
via git. Template drift vs. the 0006 schema is caught by validating every
scaffolded tree in CI.

## Final Summary

Fill this in before marking verified.
