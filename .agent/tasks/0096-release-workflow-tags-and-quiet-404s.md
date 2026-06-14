# 0096 Auto-cut workflow-ref tags & quiet expected 404s

Status: implemented
Branch: claude/amazing-goldberg-0926da

## Goal

Two dogfooding papercuts surfaced attaching loopdog to a real repo:

1. `loopdog init` scaffolds `uses: …/reusable-events.yml@v0.1.0`, but the release
   pipeline only ever cut `@loopdog/cli@X.Y.Z` tags — there is no `v*` tag. So
   every adopter's `loopdog-events.yml` fails at startup: _"reference to workflow
   should be either a valid branch, tag, or commit."_ The controller never runs.
2. On a freshly-attached/idle repo, every `status`/`run` spews GitHub 404s
   (`…/contents/runs?ref=loopdog/telemetry — 404`). They're benign — the
   run-record store ([record-store.ts](../../packages/runtime/src/telemetry/record-store.ts))
   probes the `loopdog/telemetry` branch + per-day buckets that don't exist until
   the first run, and every call site already treats "absent" as empty — but they
   read as failures.

## Fix

**Tags (no manual step at release):**
- New [scripts/sync-workflow-tags.mjs](../../scripts/sync-workflow-tags.mjs): from the
  published `@loopdog/cli` version, force-(re)point an exact `vX.Y.Z` tag and a
  floating major `vX` tag at the release commit and push them.
- [release.yml](../../.github/workflows/release.yml) runs it after the changesets
  step, gated on `steps.changesets.outputs.published == 'true'` — so it fires only
  on a real publish and **self-activates on the release that ships it**.
- Templates ([loopdog-events.yml](../../templates/workflows/loopdog-events.yml),
  [loopdog-sweep.yml](../../templates/workflows/loopdog-sweep.yml)) now pin the
  floating major `@v0` (+ `loopdog-version: '0'`, latest 0.x). `@v0` graduates to
  `@v1` at the 1.0.0 release (the script already cuts `v1` then; the template's
  one `@v0`→`@v1` edit is the only future touch).
- One-time bootstrap: `v0.2.0` + `v0` tags created by hand on the current release
  commit so existing attachments can repoint to `@v0` today.

**404s:** [octokit-github.ts](../../packages/github/src/client/octokit-github.ts) now
passes Octokit a `log` that drops request-log lines for 404 responses (warn/error).
Handled-404s were always noise; a genuinely unhandled 404 still throws a
`RequestError` with full context, so nothing real is hidden.

## Acceptance criteria

- A fresh `loopdog init` scaffolds workflows whose `uses: …@v0` resolves.
- Merging a release publishes the CLI **and** leaves `vX.Y.Z` + `vX` pointing at it,
  with no manual tagging.
- `loopdog status` on a never-run repo prints no 404 lines.
