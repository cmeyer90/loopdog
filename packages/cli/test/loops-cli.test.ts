import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '@loopdog/cli';
import { loadConfig } from '@loopdog/config';

let dirs: string[] = [];
let out: string[] = [];
let err: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  out = [];
  err = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
});
afterEach(async () => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
  process.exitCode = 0;
});

async function scaffold(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loopdog-cli-m16-'));
  dirs.push(dir);
  const program = buildProgram();
  await program.parseAsync(['node', 'loopdog', 'init', '--yes', '--path', dir]);
  return dir;
}

async function cli(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(['node', 'loopdog', ...args]);
}

describe('loopdog loops (0068)', () => {
  it('lists every built-in loop with transition/trigger/mode/tier', async () => {
    const dir = await scaffold();
    out = [];
    await cli('loops', 'list', '--path', dir);
    const text = out.join('\n');
    for (const loop of ['triage', 'groom', 'implement', 'review', 'merge', 'deploy']) {
      expect(text).toContain(loop);
    }
    expect(text).toContain('mode=dry-run');
  });

  it('loops list --json emits stable machine output', async () => {
    const dir = await scaffold();
    out = [];
    await cli('loops', 'list', '--path', dir, '--json');
    const rows = JSON.parse(out.join('\n'));
    expect(rows.find((r: { name: string }) => r.name === 'implement')).toMatchObject({
      tier: 'default',
      mode: 'dry-run',
    });
  });

  it('loops show reveals config, the prompt source, and the transition steps', async () => {
    const dir = await scaffold();
    out = [];
    await cli('loops', 'show', 'implement', '--path', dir);
    const text = out.join('\n');
    expect(text).toContain('# loop: implement');
    expect(text).toContain('dispatch to claude');
    expect(text).toContain('## prompt');
    expect(text).toContain('## steps');
  });

  it('loops show on a missing loop exits 2', async () => {
    const dir = await scaffold();
    await cli('loops', 'show', 'nope', '--path', dir);
    expect(process.exitCode).toBe(2);
    expect(err.join('\n')).toContain("no loop named 'nope'");
  });
});

describe('loopdog loops new (0078)', () => {
  it('scaffolds a loop folder, validates, and is usable', async () => {
    const dir = await scaffold();
    out = [];
    await cli(
      'loops',
      'new',
      '--path',
      dir,
      '--name',
      'dep-update',
      '--cron',
      'weekly',
      '--from',
      'scheduled',
      '--to',
      'in-review',
      '--expects',
      'pull-request',
    );
    expect(out.join('\n')).toContain('created');
    const loopYml = await readFile(join(dir, '.loopdog/loops/dep-update/loop.yml'), 'utf8');
    expect(loopYml).toContain('name: dep-update');
    expect(loopYml).toContain('cron: "weekly"');
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    expect(result.config!.loops.find((l) => l.name === 'dep-update')).toBeDefined();
  });

  it('a custom from→to declares its states so validation passes', async () => {
    const dir = await scaffold();
    out = [];
    await cli(
      'loops',
      'new',
      '--path',
      dir,
      '--name',
      'audit',
      '--event',
      'pull_request.opened',
      '--from',
      'in-review',
      '--to',
      'security-review',
      '--expects',
      'comment',
    );
    const loopYml = await readFile(join(dir, '.loopdog/loops/audit/loop.yml'), 'utf8');
    expect(loopYml).toContain('declares:');
    expect((await loadConfig(dir)).ok).toBe(true);
  });
});

describe('loopdog status control verbs (0071)', () => {
  it('pause sets a loop to dry-run; resume returns it to act; tier:core merge is refused', async () => {
    const dir = await scaffold();
    await cli('promote', 'implement', '--to', 'act', '--path', dir);
    await cli('pause', 'implement', '--path', dir);
    expect(await readFile(join(dir, '.loopdog/loops/implement/loop.yml'), 'utf8')).toContain(
      'mode: dry-run',
    );
    await cli('resume', 'implement', '--path', dir);
    expect(await readFile(join(dir, '.loopdog/loops/implement/loop.yml'), 'utf8')).toContain(
      'mode: act',
    );

    err = [];
    await cli('resume', 'merge', '--path', dir);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('tier:core merge loop');
  });

  it('budget set updates global ceilings and keeps the config valid', async () => {
    const dir = await scaffold();
    await cli('budget', 'set', '--path', dir, '--daily', '50', '--usd', '25');
    const root = await readFile(join(dir, '.loopdog/loopdog.yml'), 'utf8');
    expect(root).toContain('max_dispatches: 50');
    expect(root).toContain('max_usd: 25');
    expect((await loadConfig(dir)).ok).toBe(true);
  });
});
