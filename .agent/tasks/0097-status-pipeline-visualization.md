# 0097 `loopdog status` Pipeline Visualization & Speed-up

Status: verified
Branch: claude/stoic-gauss-7aa571

## Goal

Make `loopdog status` / `ldg status` clearly show **what loops are configured in
the repo and their live status**, and make it fast. Today the PIPELINE section is
empty unless issues happen to be open, the configured loops are never listed, and
the command makes ~17 sequential GitHub calls (~6.5s wall-clock).

## Background

`packages/cli/src/commands/status.ts` is the fleet overview. It:

- Loops `DEFAULT_STATES` (11) calling `gh.listIssuesByLabel` **sequentially**,
  then `OFF_RAMP_LABELS`+quarantine+needs-approval (6 more) **sequentially**,
  then reads the telemetry branch — every call awaited in series.
- Prints only non-zero state counts. With no open items the PIPELINE block is
  blank and the 10 configured loops are invisible.

Configured loops are `config.config.loops` (`LoopDefinition[]`): each has
`name`, `transition {from,to,fallback}`, `trigger`, `backend`, `gates.tier`,
`mode`, `expects`. `loops list` already tabulates these; `status` should fold the
config into a live fleet view tying each loop to the count of open items waiting
at its `from` state.

Dogfood target: `/Users/clarkmeyer/Desktop/looper-auto-dogfood`
(`cmeyer90/looper-auto-dogfood`, 10 loops). Baseline measured: ~6.3–6.8s, empty
PIPELINE.

## Scope

- Parallelize all GitHub reads (states + attention + telemetry) in one
  `Promise.all` batch. Include `DEPLOY_STATES` so deploy/smoke/rollback queues
  resolve.
- Render the configured loops as a lifecycle-ordered pipeline table: stage,
  flow (`from → to` + fallback), trigger, mode (act/suggest/observe), tier, and
  `WAIT` = open items currently at the loop's `from` state.
- Header summary: repo, loop counts by mode, default backend, kill-switch
  (prominent when ON). Attention + 24h throughput sections retained.
- Graceful degradation: if GitHub auth/network fails, still render the
  configuration with a clear "live counts unavailable" note (makes the command
  useful offline and never a hard failure for a read-only overview).
- `--json` stays a superset: keep `pipeline`/`attention`/`throughput`, add
  `loops` (with `waiting`) + `live`.
- Extract a pure `renderStatus(view)` + a tiny TTY-aware color helper so the
  visualization is unit-testable without GitHub.

## Out Of Scope

- The control verbs (stop/resume/pause/promote/approve/retry/budget) — untouched.
- GitHub Actions workflow enable/disable state (separate API surface).
- Any change to the state machine / labels.

## Acceptance Criteria

- [x] `status` lists every configured loop with mode + tier + live WAIT count,
      lifecycle-ordered, even when no issues are open.
- [x] All GitHub reads run in parallel; wall-clock against the dogfood repo is
      materially lower than the ~6.5s baseline.
- [x] GitHub failure renders config-only with a note, exit code 0.
- [x] `--json` is a superset of the old shape plus `loops`.
- [x] Renderer has unit tests (no network); `npm run build`, `npm test`,
      `npm run lint` pass.
- [x] Dogfooded against `looper-auto-dogfood`; before/after captured in the log.

## Test Plan

```bash
npm run build
npm test
npm run lint
# dogfood
cd /Users/clarkmeyer/Desktop/looper-auto-dogfood && \
  node <worktree>/packages/cli/dist/main.js status
```

## Verification Log

- 2026-06-13: Baseline captured against `cmeyer90/looper-auto-dogfood`:
  `ldg status` ~6.3–6.8s; PIPELINE empty; loops not shown. 17 sequential GitHub
  label queries identified as the cost.
- 2026-06-13: Implemented. `npm run build` clean, `npm test` 264/264 pass
  (9 new renderer tests in `packages/cli/test/status-view.test.ts`),
  `npm run lint` clean (eslint + boundaries + prettier).
- 2026-06-13: Dogfooded live against `cmeyer90/looper-auto-dogfood`:
  - After: all 10 loops shown lifecycle-ordered with mode/tier/WAIT + gated note;
    wall-clock dropped to ~1.3s (3 samples: 1.56/1.32/1.26s) from ~6.5s (≈5×).
  - Seeded 3 labeled demo issues (#5/#6/#7) to populate the queue: groom WAIT=2,
    implement WAIT=1 rendered bold; closed all three afterward (repo left clean).
  - Verified kill-switch ON banner (`LOOPDOG_KILL=1`), config-only degradation
    from a non-git cwd (exit 0, "live counts unavailable" note), and the
    `--json` superset (`pipeline`/`attention`/`throughput` + `loops`,`live`).

## Decisions

- Keep using the `GitHubPort.listIssuesByLabel` per-label method but fan out via
  `Promise.all` rather than adding a bulk "list all open" port method — smallest
  change, fake stays trivial, dominant cost (serial latency) removed.
- Render to a pure function for testability; colors auto-disable on non-TTY /
  `NO_COLOR`, so tests assert plain text.

## Risks / Rollback

- Low blast radius (one command + new render module). Revert = restore
  `status.ts` and delete `render/`.

## Final Summary

`loopdog status` now renders a lifecycle-ordered table of every configured loop
(STAGE → FLOW → MODE → TIER → WAIT) with a header summary (loop counts by mode,
default backend, prominent kill-switch) and the existing attention + 24h
throughput sections. WAIT = open items queued at each loop's entry state, so it's
obvious where work is piling up and which loops are actually acting vs observing.

Speed: all GitHub reads (state counts + attention + telemetry) now fan out in a
single `Promise.all` instead of ~17 serial round-trips — ~6.5s → ~1.3s. Missing
auth/network degrades to a clean config-only render (exit 0) instead of throwing.

Files: new `packages/cli/src/render/status-view.ts` (pure `renderStatus` +
`buildLoopRows`) and `packages/cli/src/render/colors.ts` (TTY/NO_COLOR-aware);
rewrote the `status` action in `packages/cli/src/commands/status.ts`; tests in
`packages/cli/test/status-view.test.ts`; docs note in `docs/quickstart.md`. The
control verbs (stop/resume/pause/promote/approve/retry/budget) are untouched.
