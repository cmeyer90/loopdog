import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Tier selection (task 0087). LOOPER_TIER chooses which slice of the five-tier
// pyramid runs. Default (and `1-4`) = the hermetic tiers, EXCLUDING the live
// smoke (`*.live.test.ts`) so a real subscription is never touched on a PR.
// `5` = only the live smoke; `all` = everything. Kept inline (no import of the
// testing barrel, which would pull vitest in at config-eval time).
const LIVE_GLOB = 'packages/*/test/**/*.live.test.ts';
const HERMETIC = ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'];
const tier = (process.env['LOOPER_TIER'] ?? '1-4').trim();
const { include, exclude } =
  tier === '5' || tier === 'live'
    ? { include: [LIVE_GLOB], exclude: [] as string[] }
    : tier === 'all'
      ? { include: [...HERMETIC, LIVE_GLOB], exclude: [] as string[] }
      : { include: HERMETIC, exclude: [LIVE_GLOB] };

export default defineConfig({
  resolve: {
    // Tests run against package sources (no build step needed); only barrel
    // imports exist, so aliasing each barrel is sufficient.
    alias: {
      '@looper/core': pkg('core'),
      '@looper/config': pkg('config'),
      '@looper/github': pkg('github'),
      '@looper/plans': pkg('plans'),
      '@looper/backends': pkg('backends'),
      '@looper/adapters': pkg('adapters'),
      '@looper/runtime': pkg('runtime'),
      '@looper/cli': pkg('cli'),
      '@looper/testing': pkg('testing'),
    },
  },
  test: {
    include,
    exclude: ['**/node_modules/**', '**/dist/**', ...exclude],
    // Hermeticity guard (self-gates on LOOPER_HERMETIC=1, set by looper-ci.yml).
    setupFiles: [
      fileURLToPath(new URL('./packages/testing/src/tiers/setup-hermetic.ts', import.meta.url)),
    ],
    passWithNoTests: true,
  },
});
