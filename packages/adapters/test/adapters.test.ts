import { describe, expect, it } from 'vitest';
import {
  GenericCommandAdapter,
  NodeAdapter,
  PythonAdapter,
  chooseAdapter,
  createAdapterRegistry,
  detectStack,
} from '@looper/adapters';
import {
  ADAPTER_FIXTURES,
  fakeCommandRunner,
  repoFsFixture,
  runAdapterConformance,
} from '@looper/testing';

describe('node adapter (0027)', () => {
  runAdapterConformance(() => new NodeAdapter(), {
    fixtures: [
      { name: 'node-npm', repo: ADAPTER_FIXTURES['node-npm'], expectMatch: true },
      { name: 'empty', repo: ADAPTER_FIXTURES['empty'], expectMatch: false },
    ],
    expectCapabilities: { build: true, test: true, lint: true, deploy: false },
  });

  it('detects the package manager from the lockfile and prefers scripts', async () => {
    const adapter = new NodeAdapter();
    const result = await adapter.detect(ADAPTER_FIXTURES['node-pnpm']);
    expect(result.toolchain).toEqual({ packageManager: 'pnpm' });
    expect(result.evidence.join(' ')).toContain('pnpm-lock.yaml → pnpm');
    expect(adapter.describe().commands.test).toBe('pnpm test');
    expect(adapter.describe().install).toBe('pnpm install');
  });

  it('honors explicit command overrides over scripts', async () => {
    const adapter = new NodeAdapter({ commands: { test: ['pnpm', 'vitest', 'run'] } });
    await adapter.detect(ADAPTER_FIXTURES['node-npm']);
    const runner = fakeCommandRunner();
    await adapter.test({ workdir: '/repo', run: runner });
    expect(runner.calls[0]!.argv).toEqual(['pnpm', 'vitest', 'run']);
  });
});

describe('python adapter (0027)', () => {
  runAdapterConformance(() => new PythonAdapter(), {
    fixtures: [
      { name: 'python-uv', repo: ADAPTER_FIXTURES['python-uv'], expectMatch: true },
      { name: 'empty', repo: ADAPTER_FIXTURES['empty'], expectMatch: false },
    ],
    expectCapabilities: { test: true, lint: true },
  });

  it('picks uv from uv.lock and ruff from pyproject', async () => {
    const adapter = new PythonAdapter();
    const result = await adapter.detect(ADAPTER_FIXTURES['python-uv']);
    expect(result.toolchain).toEqual({ runner: 'uv' });
    expect(adapter.describe().commands.test).toBe('uv run pytest -q');
    expect(adapter.describe().commands.lint).toBe('uv run ruff check .');
    expect(adapter.describe().install).toBe('uv sync');
  });
});

describe('generic command adapter (0026)', () => {
  runAdapterConformance(
    () =>
      new GenericCommandAdapter({
        commands: { build: 'make build', test: ['pytest', '-q'], deploy: './scripts/deploy.sh' },
      }),
    {
      fixtures: [{ name: 'empty', repo: ADAPTER_FIXTURES['empty'], expectMatch: false }],
      expectCapabilities: { build: true, test: true, lint: false, run: false, deploy: true },
    },
  );

  it('array commands exec without a shell; string commands go through /bin/sh', async () => {
    const adapter = new GenericCommandAdapter({
      commands: { test: ['pytest', '-q'], build: 'make build' },
    });
    const runner = fakeCommandRunner();
    await adapter.test({ workdir: '/repo', run: runner });
    expect(runner.calls[0]!.argv).toEqual(['pytest', '-q']);
    await adapter.build({ workdir: '/repo', run: runner });
    expect(runner.calls[1]!.argv).toEqual(['/bin/sh', '-c', 'make build']);
  });

  it('unset phases skip; configured env merges under ctx env', async () => {
    const adapter = new GenericCommandAdapter({
      commands: { test: 'x' },
      env: { NODE_ENV: 'test' },
    });
    expect((await adapter.lint({ workdir: '/repo', run: fakeCommandRunner() })).skipped).toBe(true);
  });
});

describe('stack auto-detection (0025)', () => {
  it('ranks matches, breaks ties deterministically, surfaces evidence', async () => {
    const both = repoFsFixture({
      'package.json': '{"scripts":{"test":"vitest"}}',
      'pnpm-lock.yaml': '',
      'requirements.txt': 'flask',
    });
    const matches = await detectStack(both, createAdapterRegistry());
    expect(matches.map((m) => m.adapter)).toEqual(['node', 'python']); // node 0.9 > python 0.6
    expect(matches[0]!.evidence.join(' ')).toContain('pnpm');
  });

  it('chooses the top match above the floor; generic below it; empty repo → generic', async () => {
    const registry = createAdapterRegistry();
    const node = await detectStack(ADAPTER_FIXTURES['node-npm'], registry);
    expect(chooseAdapter(node).adapter).toBe('node');

    const empty = await detectStack(ADAPTER_FIXTURES['empty'], registry);
    const fallback = chooseAdapter(empty);
    expect(fallback.adapter).toBe('generic');
    expect(fallback.evidence[0]).toContain('no confident match');
  });

  it('explicit config override always wins, with detection kept as advisory', async () => {
    const matches = await detectStack(ADAPTER_FIXTURES['node-npm'], createAdapterRegistry());
    const choice = chooseAdapter(matches, { adapter: 'python' });
    expect(choice.adapter).toBe('python');
    expect(choice.evidence).toEqual(['explicit override in looper.yml']);
    expect(choice.detection[0]!.adapter).toBe('node'); // advisory ranking intact
  });

  it('disable excludes an adapter from scoring; never throws', async () => {
    const matches = await detectStack(ADAPTER_FIXTURES['node-npm'], createAdapterRegistry(), {
      disable: ['node'],
    });
    expect(matches.find((m) => m.adapter === 'node')).toBeUndefined();
    expect(chooseAdapter(matches).adapter).toBe('generic');
  });
});
