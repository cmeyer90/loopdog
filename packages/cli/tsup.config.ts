import { defineConfig } from 'tsup';

// Publish-time bundle (task 0005): inlines the private @looper/* libraries so
// the published @loopdog/cli is self-contained. Third-party runtime deps stay
// external and are listed in this package's `dependencies`.
export default defineConfig({
  entry: { main: 'src/main.ts', index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  dts: false,
  sourcemap: false,
  noExternal: [/^@looper\//],
});
