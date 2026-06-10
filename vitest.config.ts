import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

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
    include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
