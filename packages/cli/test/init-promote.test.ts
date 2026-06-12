import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '@looper/cli';
import { buildScaffoldPlan } from '../src/commands/init.js';
import { findTemplatesDir } from '../src/assets.js';
import { loadConfig } from '@looper/config';

let dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'looper-cli-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
  process.exitCode = 0;
});

async function scaffold(dir: string): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(['node', 'looper', 'init', '--yes', '--path', dir]);
}

describe('looper init (0007)', () => {
  it('plans create-only on a fresh dir; the written tree passes 0006 validation', async () => {
    const dir = await tempDir();
    const plan = await buildScaffoldPlan(await findTemplatesDir(), dir);
    expect(plan.files.every((f) => f.action === 'create')).toBe(true);
    expect(plan.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        '.looper/looper.yml',
        '.looper/loops/implement/loop.yml',
        '.looper/loops/implement/prompt.md',
        '.github/workflows/looper-events.yml',
        '.github/workflows/looper-sweep.yml',
      ]),
    );
    // six built-in loops, all summarized for the preview
    expect(plan.loops.map((l) => l.name).sort()).toEqual([
      'deploy',
      'groom',
      'implement',
      'merge',
      'review',
      'triage',
    ]);

    await scaffold(dir);
    const result = await loadConfig(dir);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // safe by default (0009): every scaffolded loop resolves to dry-run
    expect(result.config!.loops.every((l) => l.mode === 'dry-run')).toBe(true);
  });

  it('re-run is idempotent: unchanged → skip; adopter-edited → conflict (never overwritten)', async () => {
    const dir = await tempDir();
    await scaffold(dir);
    const loopFile = join(dir, '.looper/loops/groom/loop.yml');
    const edited = (await readFile(loopFile, 'utf8')) + '# adopter note\n';
    await writeFile(loopFile, edited);

    const plan = await buildScaffoldPlan(await findTemplatesDir(), dir);
    const byAction = Object.groupBy(plan.files, (f) => f.action);
    expect(byAction['create']).toBeUndefined();
    expect(byAction['conflict']?.map((f) => f.path)).toEqual(['.looper/loops/groom/loop.yml']);
    expect(byAction['skip']?.length ?? 0).toBe(plan.files.length - 1);

    // re-running init never clobbers the edit
    await scaffold(dir);
    expect(await readFile(loopFile, 'utf8')).toBe(edited);
  });
});

describe('looper promote (0009)', () => {
  it('rewrites mode in place and preserves the rest of the file', async () => {
    const dir = await tempDir();
    await scaffold(dir);
    const program = buildProgram();
    await program.parseAsync(['node', 'looper', 'promote', 'groom', '--to', 'act', '--path', dir]);
    const text = await readFile(join(dir, '.looper/loops/groom/loop.yml'), 'utf8');
    expect(text).toContain('mode: act');
    expect(text).toContain('# Grooming:'); // comments preserved
    const result = await loadConfig(dir);
    expect(result.config!.loops.find((l) => l.name === 'groom')!.mode).toBe('act');
  });

  it('refuses to promote a tier:core merge loop to act', async () => {
    const dir = await tempDir();
    await scaffold(dir);
    const before = await readFile(join(dir, '.looper/loops/merge/loop.yml'), 'utf8');
    const program = buildProgram();
    await program.parseAsync(['node', 'looper', 'promote', 'merge', '--to', 'act', '--path', dir]);
    expect(process.exitCode).toBe(1);
    expect(await readFile(join(dir, '.looper/loops/merge/loop.yml'), 'utf8')).toBe(before);
  });
});
