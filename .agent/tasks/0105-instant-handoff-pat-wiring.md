# 0105 Wire LOOPDOG_PAT Through The Reusable Workflows (Instant Handoff)

Status: implemented
Branch: claude/heuristic-grothendieck-12e312

## Goal

Make controller→controller handoffs fire instantly (event-driven) when an adopter
provides a PAT, instead of always waiting for the throttled cron sweep. The
identity layer already supports this (`LOOPDOG_PAT` → `reTriggersWorkflows: true`),
and the docs already promise it — it was simply never plumbed into the reusable
workflows or the scaffolded callers.

## Background

Found while dogfooding (`cmeyer90/looper-auto-dogfood` issue #11): grooming
correctly moved the issue to `ready-for-agent`, but `implement` never dispatched
and no PR appeared. Root cause:

- The controller runs in Actions as `GITHUB_TOKEN`. GitHub deliberately does NOT
  re-trigger workflows from `GITHUB_TOKEN`-made changes, so a state-label write
  (e.g. `needs-grooming → ready-for-agent`) never fires the next loop's
  `issues: labeled` event. See `packages/github/src/identity/repo-identity.ts:44`
  (`reTriggersWorkflows: false` for the `actions` source).
- The design's answer is the **reconcile sweep** (`loopdog-sweep.yml`,
  `cron: */5 * * * *`) carrying those handoffs. But GitHub throttles
  high-frequency scheduled workflows hard — observed dogfood sweeps ran every
  ~1.5–2.5h, not every 5m — so handoffs stall for hours.
- `repo-identity.ts:33-42` already returns `source: 'pat', reTriggersWorkflows: true`
  when `LOOPDOG_PAT` is set, and `docs/security.md:38` / `docs/trust-boundary.md:16`
  / `docs/walkthroughs/connecting-accounts.md:84` already document the optional PAT
  for instant handoff. The reusable workflows only ever set `GITHUB_TOKEN`
  (`reusable-events.yml:49`, `reusable-sweep.yml:45`), so the PAT path was
  unreachable from the supported (Actions) runtime.

## Scope

- `.github/workflows/reusable-events.yml`: accept optional `loopdog_pat` secret;
  export it as `LOOPDOG_PAT` in the controller step.
- `.github/workflows/reusable-sweep.yml`: same (so sweep-initiated transitions
  also cascade instantly when a PAT is present).
- `templates/workflows/loopdog-events.yml` and `loopdog-sweep.yml`: forward
  `loopdog_pat: ${{ secrets.LOOPDOG_PAT }}` so freshly-scaffolded callers wire it.
- `loopdog connect cascade`: guided helper to store the `LOOPDOG_PAT` repo secret.
- Docs: point the existing PAT mentions at the concrete secret name + command.
- Changeset (`patch`, pre-1.0 backwards-compatible feature).

## Out Of Scope

- Auto-injecting `loopdog_pat` into already-scaffolded callers via
  `loopdog upgrade` (existing adopters re-run `init` or add the one line + secret).
- A loopdog GitHub App (deliberately post-V1).
- Activating it in the dogfood repo (needs a human-minted PAT + a release or
  branch-pin) — tracked separately in the dogfood walkthrough.

## Acceptance Criteria

- [x] When `LOOPDOG_PAT` is set as a repo secret, the controller resolves the
      `pat` identity AND builds its API client from the PAT token, so label
      transitions re-trigger `loopdog-events` (instant cascade); the sweep
      becomes a true backstop. (`resolveGitHubAuth` + `resolveRepoIdentity` now
      share PAT-first precedence — covered by `auth.test.ts`.)
- [x] When `LOOPDOG_PAT` is unset, behavior is byte-for-byte the same as today
      (empty secret → falsy → falls through to `GITHUB_TOKEN`).
- [x] `loopdog connect cascade` stores `LOOPDOG_PAT` and is idempotent like
      `connect claude`.
- [x] `permissions:` blocks of the reusable workflows are unchanged (governance
      test still passes).
- [x] `npm run build` + `npm test` + `npm run lint` pass.

## Test Plan

```bash
npm run build
npm test
npm run lint
```

## Verification Log

- 2026-06-14: Root-caused the dogfood stall on #11 (sweep cron throttle +
  GITHUB_TOKEN no-cascade). Manually ticked `loopdog-sweep` → `implement`
  dispatched → PR cmeyer90/looper-auto-dogfood#12 opened, confirming the only
  defect is handoff cadence.
- 2026-06-14: Implemented the wiring + the token-precedence unification. Found
  during review that `resolveGitHubAuth` (the API-client token) ignored
  `LOOPDOG_PAT` even though `resolveRepoIdentity` (the cascade flag) preferred it
  — so the PAT secret alone would have flipped the flag without changing the
  writing identity (inert). Fixed `resolveGitHubAuth` to prefer `LOOPDOG_PAT`.
  `npm run build` ✓, `npm test` → 311 passing (45 files) ✓, `npm run lint` ✓.

## Decisions

- Plumb the existing `LOOPDOG_PAT` rather than invent a new mechanism — the
  identity layer, tests, and docs already model it.
- Keep it opt-in: empty secret preserves today's GITHUB_TOKEN+sweep behavior, so
  the "zero-secret" default and the "no loopdog App required" promise hold.

## Risks / Rollback

- Risk: a misconfigured/over-scoped PAT. Mitigated by docs recommending a
  fine-grained PAT (issues/PR/contents: write) and storing it as a repo secret.
- Rollback: delete the `LOOPDOG_PAT` secret (instant fallback to sweep) or revert
  the four workflow/template edits.

## Final Summary

Plumbed the already-designed `LOOPDOG_PAT` instant-handoff path end-to-end.
Changed files: `.github/workflows/reusable-events.yml`,
`.github/workflows/reusable-sweep.yml`, `templates/workflows/loopdog-events.yml`,
`templates/workflows/loopdog-sweep.yml` (forward the optional `loopdog_pat`
secret → `LOOPDOG_PAT` env); `packages/github/src/identity/identity.ts`
(`resolveGitHubAuth` now PAT-first, matching `resolveRepoIdentity`);
`packages/cli/src/commands/connect.ts` (new `loopdog connect cascade`);
`packages/cli/src/commands/controller.ts` (doc comment);
`docs/walkthroughs/connecting-accounts.md`; tests `packages/github/test/auth.test.ts`
+ `scripts/test/workflow-pat-wiring.test.ts`; changeset
`.changeset/instant-handoff-pat.md`. Opt-in and backwards-compatible.

Adoption is still pending for the dogfood repo: it needs (1) this released (so
its `@v0` callers pick up the reusable change) or a branch-pin, (2) the
`loopdog_pat:` line added to its caller workflows, and (3) a human-minted
fine-grained PAT stored as the `LOOPDOG_PAT` secret. The cron sweep stays the
backstop; GitHub's schedule throttling is unchanged (and now non-blocking).
