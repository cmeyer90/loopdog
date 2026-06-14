import { createRequire } from 'node:module';

/**
 * The published CLI version — the single source of truth.
 *
 * Read via `createRequire(import.meta.url)` against `../package.json`, which
 * resolves to *this package's* `package.json` BOTH from source (this file sits
 * at `src/`) and from the tsup bundle (every chunk lands flat in `dist/`, so
 * `import.meta.url` → a `dist/*.js` file and `../` is the package root either
 * way).
 *
 * Commands must NOT read the version themselves: `src/commands/*.ts` is depth-2
 * in source, so they reached for `../../package.json` — but once bundled into
 * the flat `dist/`, that literal resolves one level *above* the installed
 * package and throws `Cannot find module '../../package.json'` (the crash that
 * broke `loopdog upgrade` / `status`). Import `CLI_VERSION` from here instead.
 */
const require = createRequire(import.meta.url);
export const CLI_VERSION: string = (require('../package.json') as { version: string }).version;
