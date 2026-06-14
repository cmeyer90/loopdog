---
'@loopdog/cli': patch
---

Fix `loopdog upgrade` / `loopdog status` crashing with `Cannot find module
'../../package.json'`. The CLI version is now read from a single bundle-safe
module (`src/version.ts`), so the flattened publish bundle resolves it relative to
the installed package instead of one level above it.
