import { describe, expect, it } from 'vitest';
import type {
  AdapterCapabilities,
  AdapterPhase,
  CommandContext,
  CommandRunner,
  ProjectAdapter,
  RepoFs,
} from '@loopdog/core';

/**
 * Adapter conformance kit (task 0028): drives every clause of the 0024
 * `ProjectAdapter` contract against a candidate adapter. Bundled adapters and
 * third-party adapters share this one definition of conformance. Deterministic,
 * offline, process-free (the fake runner records instead of spawning).
 */

export interface FakeCommandRunner extends CommandRunner {
  calls: Array<{ argv: string[]; cwd: string }>;
}

export function fakeCommandRunner(
  script: Partial<Record<string, { exitCode: number; stdout?: string; stderr?: string }>> = {},
): FakeCommandRunner {
  const calls: FakeCommandRunner['calls'] = [];
  const runner = (async (argv: string[], opts: { cwd: string }) => {
    calls.push({ argv, cwd: opts.cwd });
    const key = argv.join(' ');
    const match = Object.entries(script).find(([needle]) => key.includes(needle))?.[1];
    return {
      exitCode: match?.exitCode ?? 0,
      stdout: match?.stdout ?? 'ok',
      stderr: match?.stderr ?? '',
      durationMs: 5,
    };
  }) as FakeCommandRunner;
  runner.calls = calls;
  return runner;
}

/** In-memory RepoFs fixture from a path → content map. */
export function repoFsFixture(files: Record<string, string>): RepoFs {
  const paths = Object.keys(files);
  return {
    exists: async (path) => path in files || paths.some((p) => p.startsWith(`${path}/`)),
    read: async (path) => files[path] ?? null,
    list: async (dir) => {
      const prefix = dir === '' || dir === '.' ? '' : `${dir.replace(/\/$/, '')}/`;
      return [
        ...new Set(
          paths
            .filter((p) => p.startsWith(prefix))
            .map((p) => p.slice(prefix.length).split('/')[0]!),
        ),
      ].sort();
    },
  };
}

/** Reusable fixture library (mirrors what 0025/0027 consume). */
export const ADAPTER_FIXTURES = {
  'node-npm': repoFsFixture({
    'package.json': JSON.stringify({
      name: 'x',
      scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
    }),
    'package-lock.json': '{}',
  }),
  'node-pnpm': repoFsFixture({
    'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }),
    'pnpm-lock.yaml': '',
  }),
  'python-uv': repoFsFixture({
    'pyproject.toml': '[project]\nname = "x"\n[tool.ruff]\nline-length = 100\n',
    'uv.lock': '',
    'tests/test_x.py': 'def test_ok(): pass',
  }),
  empty: repoFsFixture({}),
} as const;

export interface AdapterConformanceOpts {
  /** At least one fixture this adapter SHOULD match, and the no-match case. */
  fixtures: Array<{ name: string; repo: RepoFs; expectMatch: boolean }>;
  runner?: FakeCommandRunner;
  expectCapabilities?: Partial<AdapterCapabilities>;
}

const PHASES: AdapterPhase[] = ['build', 'test', 'lint', 'run', 'deploy'];

/** Registers its own it() cases — call inside a describe(). */
export function runAdapterConformance(
  makeAdapter: () => ProjectAdapter,
  opts: AdapterConformanceOpts,
): void {
  describe('adapter conformance (0024/0028)', () => {
    it('1. shape: exposes name + every contract method', () => {
      const adapter = makeAdapter();
      expect(typeof adapter.name).toBe('string');
      expect(adapter.name.length).toBeGreaterThan(0);
      for (const method of ['detect', 'capabilities', 'describe', ...PHASES] as const) {
        expect(typeof adapter[method], `${method} must be a function`).toBe('function');
      }
    });

    it('2. detect contract: confidence in [0,1]; matched agrees with the fixture', async () => {
      for (const fixture of opts.fixtures) {
        const adapter = makeAdapter();
        const result = await adapter.detect(fixture.repo);
        expect(result.confidence, fixture.name).toBeGreaterThanOrEqual(0);
        expect(result.confidence, fixture.name).toBeLessThanOrEqual(1);
        expect(result.matched, `${fixture.name} expectMatch`).toBe(fixture.expectMatch);
        expect(Array.isArray(result.evidence), fixture.name).toBe(true);
        if (!fixture.expectMatch) expect(result.confidence).toBeLessThan(0.5);
      }
    });

    it('3. capability honesty: false phases skip; true phases invoke the runner', async () => {
      const matchFixture = opts.fixtures.find((f) => f.expectMatch);
      const adapter = makeAdapter();
      if (matchFixture) await adapter.detect(matchFixture.repo);
      const caps = adapter.capabilities();
      if (opts.expectCapabilities) expect(caps).toMatchObject(opts.expectCapabilities);

      for (const phase of PHASES) {
        const runner = fakeCommandRunner();
        const ctx: CommandContext = { workdir: '/repo', run: runner };
        const result = await adapter[phase](ctx);
        if (caps[phase]) {
          expect(runner.calls.length, `${phase} should invoke the runner`).toBeGreaterThan(0);
        } else {
          expect(result.skipped, `${phase} should skip`).toBe(true);
          expect(result.ok).toBe(true);
          expect(result.durationMs).toBe(0);
          expect(runner.calls).toHaveLength(0);
        }
      }
    });

    it('4. result normalization: pass and fail branches are well-formed', async () => {
      const matchFixture = opts.fixtures.find((f) => f.expectMatch);
      const adapter = makeAdapter();
      if (matchFixture) await adapter.detect(matchFixture.repo);
      const caps = adapter.capabilities();
      const phase = PHASES.find((p) => caps[p]);
      if (!phase) return; // an adapter may support nothing (e.g. unconfigured generic)

      const pass = await adapter[phase]({ workdir: '/repo', run: fakeCommandRunner() });
      expect(pass).toMatchObject({ ok: true });
      expect(typeof pass.output).toBe('string');
      expect(pass.durationMs).toBeGreaterThanOrEqual(0);

      const failing = fakeCommandRunner({ '': { exitCode: 2, stderr: 'boom' } });
      const fail = await adapter[phase]({ workdir: '/repo', run: failing });
      expect(fail.ok).toBe(false);
      expect(fail.exitCode).toBe(2);
      expect(fail.output).toContain('boom');
    });

    it('5. no direct spawning: every execution goes through the injected runner', async () => {
      const matchFixture = opts.fixtures.find((f) => f.expectMatch);
      const adapter = makeAdapter();
      if (matchFixture) await adapter.detect(matchFixture.repo);
      const caps = adapter.capabilities();
      const runner = fakeCommandRunner();
      for (const phase of PHASES) {
        if (caps[phase]) await adapter[phase]({ workdir: '/repo', run: runner });
      }
      const supported = PHASES.filter((p) => caps[p]).length;
      expect(runner.calls.length).toBeGreaterThanOrEqual(supported);
    });

    it('6. describe documents a non-empty command per supported phase', async () => {
      const matchFixture = opts.fixtures.find((f) => f.expectMatch);
      const adapter = makeAdapter();
      if (matchFixture) await adapter.detect(matchFixture.repo);
      const caps = adapter.capabilities();
      const description = adapter.describe();
      for (const phase of PHASES) {
        if (caps[phase]) {
          expect(description.commands[phase], `describe().commands.${phase}`).toBeTruthy();
        }
      }
    });

    it('7. detect is idempotent (pure, read-only)', async () => {
      for (const fixture of opts.fixtures) {
        const adapter = makeAdapter();
        const first = await adapter.detect(fixture.repo);
        const second = await adapter.detect(fixture.repo);
        expect(second).toEqual(first);
      }
    });
  });
}
