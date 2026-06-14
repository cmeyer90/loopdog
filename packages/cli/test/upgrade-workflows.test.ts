import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '@loopdog/cli';
import { retargetCallerWorkflow } from '../src/commands/upgrade-workflows.js';

let dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loopdog-upgrade-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
  process.exitCode = 0;
});

const EXACT_EVENTS = `name: loopdog-events
on:
  issues:
    types: [opened, edited]
jobs:
  loopdog:
    # immutable SHA pin
    uses: cmeyer90/loopdog/.github/workflows/reusable-events.yml@24095904c823d865e6fe704e57d7963344824495
    with:
      loopdog-version: 0.2.0
    secrets:
      claude_fire_url: \${{ secrets.LOOPDOG_CLAUDE_FIRE_URL }}
`;

describe('retargetCallerWorkflow (0100)', () => {
  it('floats an exact/SHA-pinned caller to the major tag, preserving the rest', () => {
    const { content, changes } = retargetCallerWorkflow(EXACT_EVENTS, 0);
    expect(content).toContain('reusable-events.yml@v0');
    expect(content).toContain("loopdog-version: '0'");
    // owner/repo, secrets, comments untouched
    expect(content).toContain('cmeyer90/loopdog/.github/workflows/reusable-events.yml@v0');
    expect(content).toContain('claude_fire_url: ${{ secrets.LOOPDOG_CLAUDE_FIRE_URL }}');
    expect(content).toContain('# immutable SHA pin');
    expect(changes).toEqual([
      { field: 'uses', from: '2409590', to: 'v0' },
      { field: 'loopdog-version', from: '0.2.0', to: '0' },
    ]);
  });

  it('is a no-op when already floating on the major', () => {
    const floating = EXACT_EVENTS.replace(
      'reusable-events.yml@24095904c823d865e6fe704e57d7963344824495',
      'reusable-events.yml@v0',
    ).replace('loopdog-version: 0.2.0', "loopdog-version: '0'");
    const { content, changes } = retargetCallerWorkflow(floating, 0);
    expect(changes).toEqual([]);
    expect(content).toBe(floating);
  });

  it('rewrites an exact tag pin too, and preserves a trailing comment', () => {
    const src = `    uses: org/loopdog/.github/workflows/reusable-sweep.yml@v0.2.0
    with:
      loopdog-version: 0.2.0 # pinned exact
`;
    const { content, changes } = retargetCallerWorkflow(src, 0);
    expect(content).toContain('reusable-sweep.yml@v0');
    expect(content).toContain("loopdog-version: '0' # pinned exact");
    expect(changes.map((c) => c.field)).toEqual(['uses', 'loopdog-version']);
  });

  it('leaves a non-loopdog workflow untouched', () => {
    const ci = `name: ci
jobs:
  test:
    uses: ./.github/workflows/other.yml@v3
`;
    const { content, changes } = retargetCallerWorkflow(ci, 0);
    expect(changes).toEqual([]);
    expect(content).toBe(ci);
  });
});

describe('loopdog upgrade re-syncs caller workflows (0100)', () => {
  async function scaffold(dir: string): Promise<void> {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'loopdog',
      'init',
      '--yes',
      '--no-enable-workflows',
      '--path',
      dir,
    ]);
  }

  it('floats a drifted caller even when the config is already current; --dry-run writes nothing', async () => {
    const dir = await tempDir();
    await scaffold(dir);
    const eventsFile = join(dir, '.github/workflows/loopdog-events.yml');
    await writeFile(eventsFile, EXACT_EVENTS);
    // a non-loopdog workflow must be ignored
    const ciFile = join(dir, '.github/workflows/ci.yml');
    await writeFile(ciFile, 'name: ci\non: push\n');

    const program = buildProgram();
    await program.parseAsync(['node', 'loopdog', 'upgrade', '--dry-run', '--path', dir]);
    expect(await readFile(eventsFile, 'utf8')).toBe(EXACT_EVENTS); // dry-run: untouched

    const program2 = buildProgram();
    await program2.parseAsync(['node', 'loopdog', 'upgrade', '--path', dir]);
    const after = await readFile(eventsFile, 'utf8');
    expect(after).toContain('reusable-events.yml@v0');
    expect(after).toContain("loopdog-version: '0'");
    expect(await readFile(ciFile, 'utf8')).toBe('name: ci\non: push\n'); // untouched
  });

  it('does not error when there is no .github/workflows directory', async () => {
    const dir = await tempDir();
    await scaffold(dir);
    await rm(join(dir, '.github'), { recursive: true, force: true }); // self-hosted-only shape
    const program = buildProgram();
    await program.parseAsync(['node', 'loopdog', 'upgrade', '--path', dir]);
    expect(process.exitCode ?? 0).not.toBe(2);
  });
});
