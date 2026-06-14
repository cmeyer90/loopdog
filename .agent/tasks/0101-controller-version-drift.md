# 0101 Surface Controller-Version Drift in `status`

Status: verified
Branch: task/0101-controller-version-drift

## Goal

When the operator updates their local `@loopdog/cli` but the attached repo's
controller is pinned to an older exact version, `loopdog status` should say so and
point at `loopdog upgrade` — so a stale (and possibly buggy) controller is
discoverable instead of silently lagging.

## Background

The controller runs whatever `@loopdog/cli` version the caller workflows pin
(`loopdog-version`). Floating pins (`'N'` + `@vN`) auto-track every release;
exact pins (`0.2.0`) do not, and updating the local CLI does nothing to them.
[0100](0100-controller-version-sync.md) makes `loopdog upgrade` *fix* the drift,
but nothing *tells* the operator to run it — exactly how the dogfood repo sat on
0.2.0 (claim bug) after 0.4.0 shipped the fix.

This adds the missing nudge: a read-only drift check surfaced in the `status`
overview the operator already runs.

Relevant files:

- `packages/cli/src/commands/status.ts` — gathers data, owns `--path`.
- `packages/cli/src/render/status-view.ts` — pure renderer + `StatusView`.

## Scope

- Pure module `controller-version.ts`: `readPinnedVersion(content)` +
  `assessControllerDrift(callerContents, cliVersion)` → `{ status, pinned, cli }`
  where status ∈ `floating | current | behind | ahead | none`.
- `status` reads the local `.github/workflows/loopdog-*.yml` pins (best-effort,
  independent of the GitHub live fetch), assesses drift vs the installed CLI, and
  renders a one-line nudge when `behind` (and a soft note when `ahead`).
- `--json` carries a `controller` field.

## Out Of Scope

- Changing pins (that's `loopdog upgrade`, task 0100).
- Nudging on every command (status is the health overview and the right home).
- Comparing the `uses:` reusable-workflow ref (can't version-compare a SHA);
  drift keys off `loopdog-version`, which is what actually installs the CLI.

## Acceptance Criteria

- [x] `assessControllerDrift` returns `behind` for an exact pin older than the
      CLI, `floating` for a bare major, `current`/`ahead` for equal/newer, `none`
      when no caller pins a version; worst-case across callers wins.
- [x] `status` shows a `loopdog upgrade` nudge when behind; silent when floating
      or current; never hard-fails when there are no caller workflows.
- [x] `npm run build`, `npm test`, `npm run lint` pass.
- [x] Verified live against `cmeyer90/looper-auto-dogfood` (shows the nudge).

## Implementation Checklist

- [ ] Add `packages/cli/src/commands/controller-version.ts` (pure).
- [ ] Add `controller` to `StatusView` + render the nudge.
- [ ] Read caller pins in `status.ts`; add to `--json`.
- [ ] Tests: pure-assessor cases + a render assertion.
- [ ] Docs: quickstart troubleshooting points at the nudge.

## Test Plan

```bash
npm run build && npm test && npm run lint
node packages/cli/dist/main.js status --path ~/Desktop/looper-auto-dogfood
```

## Verification Log

- 2026-06-14: branched off origin/main.
- 2026-06-14: `npm run build` — passed.
- 2026-06-14: `npm test` — passed, 291 tests / 40 files (+8 `controller-version`
  pure-assessor cases incl. numeric-vs-lexical compare + worst-case; +2 render
  cases in `status-view`).
- 2026-06-14: `npm run lint` — passed.
- 2026-06-14: live `status --path ~/Desktop/looper-auto-dogfood` → header shows
  `⚠ controller pinned v0.2.0 · CLI v0.4.0 — run loopdog upgrade to re-sync`;
  `--json` carries `"controller": { status: behind, pinned: 0.2.0, cli: 0.4.0 }`.

## Decisions

- Drift keys off `loopdog-version` (the value that installs the runtime CLI), not
  the `uses:` ref (a SHA can't be version-compared).
- Read pins from the LOCAL working tree (consistent with what `upgrade` edits);
  good enough as a nudge even though the deployed truth is the default branch.
- Independent of 0100: a new read/assess module, separate responsibility from
  0100's pin rewriter. A future cleanup could share the regex.

## Risks / Rollback

- A false "behind" would be noise; mitigated by only flagging an exact pin that
  version-compares older than the CLI. Rollback: revert the branch.

## Final Summary

`loopdog status` now surfaces controller-version drift. New pure module
`controller-version.ts` reads each caller workflow's `loopdog-version` pin and
assesses it against the installed CLI (`floating | current | behind | ahead |
none`, worst-case across callers, numeric compare). `status` reads the local
caller pins best-effort (independent of the GitHub live fetch), adds a
`controller` field to `StatusView` + `--json`, and renders a one-line
`loopdog upgrade` nudge only when behind (silent when floating/current). Closes
the discoverability gap left by [0100](0100-controller-version-sync.md): status
tells you when the controller is stale, upgrade re-syncs it.

Changed files: `packages/cli/src/commands/controller-version.ts` (new),
`packages/cli/src/commands/status.ts`, `packages/cli/src/render/status-view.ts`,
`packages/cli/test/controller-version.test.ts` (new),
`packages/cli/test/status-view.test.ts`, `docs/quickstart.md`,
`.changeset/status-controller-drift.md`.
