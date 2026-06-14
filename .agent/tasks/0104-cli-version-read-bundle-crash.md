# 0104 Fix Bundled CLI Crash Reading `../../package.json`

Status: implemented  
Branch: claude/gallant-tu-b70bd2

## Goal

Stop the published `@loopdog/cli` from crashing with
`Cannot find module '../../package.json'` on `ldg upgrade` / `ldg status`.

## Background

Reported from the dogfood repo: a fresh `npm i -g @loopdog/cli@latest && ldg
upgrade` throws `MODULE_NOT_FOUND` for `../../package.json` from
`dist/chunk-*.js`. Cause: the CLI read its own version with
`require('../../package.json')` in `src/commands/status.ts` and
`src/commands/upgrade.ts`. That depth-2 path is correct in source
(`src/commands/`) but tsup (`tsup.config.ts`, `noExternal: @loopdog/*`) flattens
every module into a single `dist/`, and esbuild keeps the literal string. At
runtime `createRequire(import.meta.url)` resolves it relative to the `dist/`
chunk, so `../../package.json` lands one level *above* the installed package and
throws. `src/program.ts` used `../package.json` (depth-1) and happened to work
because `src/` and `dist/` are both depth-1.

## Scope

- Add `src/version.ts` (depth-1, bundle-safe) as the single source of truth for
  `CLI_VERSION`.
- Route `program.ts`, `commands/status.ts`, `commands/upgrade.ts` through it;
  delete their local `createRequire` / package.json reads.

## Out Of Scope

- Changing the publish/bundling pipeline (tsup config), version scheme, or the
  `bin` shims — the depth-1 read is sufficient and minimal.

## Acceptance Criteria

- [x] `node dist/main.js --version`, `… upgrade --help`, `… status --help` all
      run against the tsup bundle without `MODULE_NOT_FOUND`.
- [x] `version.ts` is the only file that reads `package.json`; no
      `../../package.json` remains (guarded by a test).
- [x] `npm run build`, `npm test`, `npm run lint` pass.

## Test Plan

```bash
npm run build && npm test && npm run lint
# bundle smoke (publish layout):
( cd packages/cli && npx tsup && node dist/main.js --version && \
  node dist/main.js upgrade --help && node dist/main.js status --help )
```

- New `packages/cli/test/version.test.ts`: asserts `version.ts` is the sole
  `package.json` reader and the `../../package.json` literal is gone.

## Verification Log

- 2026-06-14: Reproduced cause by inspecting the tsup bundle
  (`var CLI_VERSION = require2("../../package.json")…`). After the fix the bundle
  emits a single `require2("../package.json")`. Ran the bundled CLI:
  `--version` → `0.6.0`, `upgrade --help` and `status --help` → clean (no
  MODULE_NOT_FOUND). `npm run build` / `npm test` / `npm run lint` green.

## Decisions

- Centralized the version read rather than just changing `../../` → `../` in the
  command files: depth-1 `../package.json` is correct in BOTH source and bundle,
  and one source of truth prevents a depth-2 read from creeping back in.

## Risks / Rollback

- Low. Pure refactor of an existing read; behavior verified against the actual
  bundle. Revert is the diff.

## Final Summary

Bundled CLI no longer crashes on `upgrade`/`status`. The version is read once,
in `src/version.ts`, via a depth-1 `../package.json` that resolves correctly
both from `src/` (dev/tests) and from the flattened `dist/` bundle. A test guards
against reintroducing a deeper read. Ships in PR #20 alongside task 0103.
