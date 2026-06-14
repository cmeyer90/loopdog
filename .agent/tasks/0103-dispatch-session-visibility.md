# 0103 Dispatch Session Visibility & `/fire` Debug Logging

Status: implemented  
Branch: claude/gallant-tu-b70bd2

## Goal

Give operators visibility into the Claude work cell loopdog launches at dispatch:
(1) surface the live session URL where a human looks when a build starts, and
(2) make the `/fire` round-trip debuggable behind an opt-in env flag.

## Background

Claude dispatch is a fire-and-forget POST to the routine `/fire` URL
(`packages/backends/src/claude/claude-backend.ts`). The response carries a
`session_id` and optional `session_url`; both are stored in the `DispatchHandle`
signal and (via `sessionArtifact`) in the run record's `outcome.artifacts.session`.

Gaps today:

- The **dispatch marker comment** (`renderDispatchMarker`) shows runId / backend /
  branch / trailer / timestamp but **not** the session link — the link is only
  JSON-buried in the HTML comment.
- The controller **event/sweep console + job-summary** lines show
  `loop #N: status` with no session link.
- There is **no logging** around the `/fire` call, so a missing `session_url`
  or an odd response is undiagnosable.

## Scope

- Render the session in `renderDispatchMarker` (claude-session: prefer
  `sessionUrl`, fall back to a real `sessionId`; skip the literal
  `unknown-session`; no line for other signal kinds).
- Append the session artifact to the controller `event` and `sweep` output lines
  (console + job summary). Thread `session` through `SweepSummary.processed`.
- Add opt-in `LOOPDOG_DEBUG` logging to the Claude backend `dispatch`: log the
  request (method, URL, run, item, instruction bytes) and response (HTTP status,
  elapsed ms, sessionId, sessionUrl, truncated body) to **stderr**. Never log the
  bearer token.
- Document `LOOPDOG_DEBUG` in the config reference.

## Out Of Scope

- Live mid-build status polling of the session (needs a routine read endpoint;
  separate, larger task).
- Persisting the full composed brief text (only `briefRef` is stored today).
- A shared logger module — keep the debug helper local to the one dispatch site.

## Acceptance Criteria

- [x] Dispatch marker shows a clickable live-session line for a claude-session
      with a URL, falls back to the session id, and omits the line otherwise.
- [x] `loopdog controller event`/`sweep` output includes the session when present.
- [x] `LOOPDOG_DEBUG` logs the `/fire` request + response to stderr; unset = silent;
      token never logged.
- [x] `LOOPDOG_DEBUG` documented in `docs/config-reference.md`.
- [x] `npm run build`, `npm test`, `npm run lint` pass.

## Test Plan

```bash
npm run build
npm test
npm run lint
```

- New `packages/runtime/test/dispatch-marker.test.ts`: URL line / id fallback /
  omitted-for-non-claude / unknown-session skipped.
- Extend `packages/backends/test/backends.test.ts`: `LOOPDOG_DEBUG` on → stderr
  logging incl. status + session, token absent; off → no logging.

## Verification Log

- 2026-06-14: task created; implementation starting.
- 2026-06-14: `npm run build` clean; `npm test` → 287 passed (40 files);
  `npm run lint` (eslint + boundaries + prettier) clean. Two scenario goldens
  (`example-node-todo`, `implement-happy-path`) re-baselined: the only diff is the
  dispatch-marker `bodyDigest`, from the new `🔭 session:` line (FakeBackend emits
  a `fake-session-N` id, already deterministic and already embedded in the marker
  JSON, so the byte-identical-across-runs property holds). Not exercised: a live
  `/fire` against a real routine (needs subscription secrets) — covered by unit
  tests on the marker + the `LOOPDOG_DEBUG` log path instead.

## Decisions

- Debug helper kept inline in the Claude backend (single dispatch site) per
  AGENTS.md "smallest coherent change" — no new logger package/module yet.
- Logs go to **stderr** so stdout (structured CLI output / job summaries) stays clean.

## Risks / Rollback

- Low blast radius: additive output lines + an env-gated log path. Revert is the
  diff. Main care points: never log the token; keep `processed.session` optional
  so existing `toEqual` assertions still pass.

## Final Summary

Two visibility additions for the Claude work cell loopdog launches at dispatch:

1. **Live session surfaced.** `renderDispatchMarker` now prints a `🔭 live session:`
   link (URL → auto-linked by GitHub; falls back to the session id; skips the
   `unknown-session` placeholder and non-Claude signals). The controller
   `event`/`sweep` console + job-summary lines append the session artifact.
2. **`/fire` round-trip tracing.** Setting `LOOPDOG_DEBUG` logs the request
   (URL, run, item, instruction bytes) and response (status, elapsed ms, session
   id/URL — or a truncated body on failure) to stderr. The bearer token is never
   logged; off by default.

Changed: `packages/backends/src/claude/claude-backend.ts`,
`packages/runtime/src/pipeline/dispatch-marker.ts`,
`packages/runtime/src/sweep/sweep.ts`,
`packages/cli/src/commands/controller.ts`, `docs/config-reference.md`. Tests:
new `packages/runtime/test/dispatch-marker.test.ts`, extended
`packages/backends/test/backends.test.ts`; two goldens re-baselined.
