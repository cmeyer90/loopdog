# 0099 CLI Workflow Enable/Disable

Status: verified
Branch: task/0099-cli-workflow-toggle

## Goal

Let an operator turn loopdog's GitHub Actions workflows (`loopdog-events`,
`loopdog-sweep`, …) on and off from the CLI, and make a fresh attach leave them
enabled — so a repo whose events/sweep workflows were disabled stops silently
swallowing new issues.

## Background

The controller only runs because two scaffolded workflows fire it:
`loopdog-events` (issue/PR events → intake + event-driven transitions) and
`loopdog-sweep` (cron reconcile tick that carries items forward). If either is
`disabled_manually` or `disabled_inactivity` (GitHub auto-disables a scheduled
workflow after 60 days of repo inactivity), opening an issue does nothing and
`loopdog status` shows an empty pipeline with no obvious cause — exactly the
dogfood symptom that motivated this task (events + sweep were `disabled_manually`
on `cmeyer90/looper-auto-dogfood`).

There was no loopdog command to inspect or change Actions workflow state; the
only path was `gh workflow enable/disable` by hand. This adds a first-class
control surface that mirrors how `promote`/`status` already wrap GitHub ops.

Relevant files:

- `packages/core/src/ports/github-port.ts` — the `GitHubPort` capability set.
- `packages/github/src/client/octokit-github.ts` — production port impl.
- `packages/testing/src/fake-github/fake-github.ts` — in-memory port for tests.
- `packages/cli/src/commands/*` — `promote.ts`/`status.ts`/`run.ts` are the
  patterns for a repo-resolving, gh-auth CLI command.
- `packages/cli/src/commands/init.ts` — the attach flow.

## Scope

- New `WorkflowsPort` capability on `GitHubPort`: `listWorkflows`,
  `enableWorkflow`, `disableWorkflow`; exported types `WorkflowSummary` /
  `WorkflowRunState`.
- Implement it in `OctokitGitHub` (Actions REST) and in `FakeGitHub` (in-memory,
  with a `seedWorkflow` helper + recorded state for assertions).
- New `loopdog workflows` command group:
  - `list` (default) — show loopdog workflows + enabled/disabled state.
  - `enable [names…]` — enable (default: all loopdog workflows).
  - `disable [names…]` — disable (default: all loopdog workflows).
  - name matching accepts `events`, `loopdog-events`, `loopdog-events.yml`.
- `loopdog init`: best-effort enable of already-registered loopdog workflows on
  attach (re-attach / previously-disabled case), and next-steps guidance that a
  scheduled workflow can be re-enabled with `loopdog workflows enable`.

## Out Of Scope

- Touching the user's own (non-loopdog) workflows by default — `enable`/`disable`
  with no names targets only `loopdog-*`. A named non-loopdog workflow is allowed
  but never the default.
- Creating/deleting workflow files (that's `init`'s scaffold) or editing their
  YAML.
- Any controller-runtime use of enable/disable — this is a human/operator surface
  only (uses the operator's `gh` token, not the runtime `GITHUB_TOKEN`).

## Acceptance Criteria

- [x] `GitHubPort` gains `listWorkflows`/`enableWorkflow`/`disableWorkflow`,
      implemented in both the Octokit and fake ports (conformance parity).
- [x] `loopdog workflows` lists state; `enable`/`disable` flip it and are
      idempotent; default target is the loopdog workflows only.
- [x] Unknown workflow names and not-yet-pushed workflows produce a clear,
      non-crashing message (hint to push first).
- [x] `loopdog init` leaves already-registered loopdog workflows enabled and
      never hard-fails when GitHub is unreachable/offline.
- [x] `npm run build`, `npm test`, `npm run lint` pass.
- [x] Verified live against `cmeyer90/looper-auto-dogfood`.

## Implementation Checklist

- [ ] Add `WorkflowsPort` + types to core; export from `index.ts`.
- [ ] Implement in `OctokitGitHub`.
- [ ] Implement in `FakeGitHub` (+ `seedWorkflow`).
- [ ] Add `packages/cli/src/commands/workflows.ts` with pure helpers
      (`isLoopdogWorkflow`, `matchWorkflow`, `selectTargets`, `renderWorkflowList`)
      delegated to by the command.
- [ ] Register in `program.ts`.
- [ ] Wire best-effort enable + guidance into `init.ts`.
- [ ] Tests: pure-helper unit tests + FakeGitHub round-trip.
- [ ] Docs: quickstart/troubleshooting note.

## Test Plan

```bash
npm run build
npm test
npm run lint
# live (operator):
loopdog workflows --repo cmeyer90/looper-auto-dogfood
loopdog workflows enable --repo cmeyer90/looper-auto-dogfood
```

## Verification Log

- 2026-06-13: baseline `npm run build` — passed.
- 2026-06-13: `npm run build` — passed (all packages typecheck with the new port).
- 2026-06-13: `npm test` — passed, 281 tests / 39 files (incl. new
  `workflows-cli.test.ts`: 10 tests — pure helpers + FakeGitHub round-trip).
- 2026-06-13: `npm run lint` — passed (eslint + package boundaries + prettier).
- 2026-06-13: live against `cmeyer90/looper-auto-dogfood` with the built CLI:
  - `wf` / `wf list --all` / `wf list --json` — read state correctly (events +
    sweep showed `disabled_manually`).
  - `wf enable bogus` — clear error, exit 2.
  - `wf enable` — re-enabled events + sweep (deploy already active); re-read
    confirmed all 3 active; re-run idempotent (all "already active").
  - `wf disable sweep` then `wf enable sweep` — named round-trip works.
  - Net effect: the dogfood repo's controller is unstuck (events + sweep on).

## Decisions

- enable/disable default to **loopdog-owned** workflows only; the user's `ci`
  workflow is never touched unless named explicitly. Rationale: least surprise.
- `init`'s GitHub step is strictly best-effort and non-fatal: a first attach has
  no registered workflows yet (they register on first push and start enabled),
  so init can only *re-enable* on a re-attach; offline/no-auth is a soft note,
  never an `init` failure.

## Risks / Rollback

- enable/disable need a token with `repo` scope (the operator's `gh` auth has
  it); the runtime `GITHUB_TOKEN` is never used for this. Low blast radius —
  it only flips Actions on/off, reversible by the inverse command.
- Rollback: revert the branch; no persisted state or schema change.

## Final Summary

Added a `WorkflowsPort` capability (`listWorkflows`/`enableWorkflow`/
`disableWorkflow`) to `@loopdog/core`'s GitHub port, implemented in both
`OctokitGitHub` (Actions REST) and `FakeGitHub` (in-memory, with `seedWorkflow`).
New `loopdog workflows` (alias `wf`) command: `list` (default; `--all`/`--json`),
`enable [names…]`, `disable [names…]`. Defaults to loopdog-owned workflows only;
named workflows resolve against all of them; idempotent; unknown names exit 2
with a hint. `loopdog init` now best-effort re-enables already-registered loopdog
workflows on attach (non-fatal when offline/no-auth/first-attach) and points at
the new command in its next steps. Quickstart gained a "Nothing happened?"
troubleshooting note. Changeset: `@loopdog/cli` minor (fixed group bumps all
`@loopdog/*`).

Changed files: `packages/core/src/ports/github-port.ts`,
`packages/core/src/index.ts`, `packages/github/src/client/octokit-github.ts`,
`packages/testing/src/fake-github/fake-github.ts`,
`packages/cli/src/commands/workflows.ts` (new),
`packages/cli/src/commands/init.ts`, `packages/cli/src/program.ts`,
`packages/cli/test/workflows-cli.test.ts` (new), `docs/quickstart.md`,
`.changeset/workflow-onoff.md`.
