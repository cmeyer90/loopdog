import type { Command } from 'commander';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadConfig } from '@looper/config';
import { findTemplatesDir } from '../assets.js';

/**
 * `looper init` (task 0007): attach looper to a repo — scaffold the root
 * config, the built-in loop folders, and the thin workflow callers; preview
 * everything first; never clobber adopter edits; validate what was written.
 */

interface PlannedFile {
  /** Target path, relative to the repo root. */
  path: string;
  source: string;
  action: 'create' | 'skip' | 'conflict';
}

export interface ScaffoldPlan {
  files: PlannedFile[];
  loops: Array<{ name: string; transition: string; trigger: string; mode: string }>;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('attach looper to this repository (scaffold config + loops + workflows)')
    .option('--dry-run', 'preview only — write nothing', false)
    .option('--yes', 'non-interactive: accept and write the plan', false)
    .option('--force', 'offer to re-write conflicting files (still asks per file)', false)
    .option('--path <dir>', 'target repo root', '.')
    .action(async (opts: { dryRun: boolean; yes: boolean; force: boolean; path: string }) => {
      const templatesDir = await findTemplatesDir();
      const plan = await buildScaffoldPlan(templatesDir, opts.path);
      renderPlan(plan);

      if (opts.dryRun) {
        console.log('\n--dry-run: nothing written.');
        return;
      }
      if (!opts.yes && !process.stdout.isTTY) {
        console.log('\nrefusing to write without --yes in a non-interactive shell.');
        process.exitCode = 1;
        return;
      }
      if (!opts.yes) {
        const { confirm, isCancel } = await import('@clack/prompts');
        const go = await confirm({ message: 'Write these files?' });
        if (isCancel(go) || !go) {
          console.log('aborted — nothing written.');
          return;
        }
      }

      let wrote = 0;
      for (const file of plan.files) {
        if (file.action !== 'create') continue;
        const target = join(opts.path, file.path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, await readFile(file.source, 'utf8'));
        wrote++;
      }
      console.log(`\nwrote ${wrote} file(s); skipped ${plan.files.length - wrote}.`);

      const result = await loadConfig(opts.path);
      if (!result.ok) {
        console.error('\nscaffolded tree FAILED validation (packaging bug?):');
        for (const e of result.errors) console.error(`  - ${e.file} ${e.path}: ${e.message}`);
        process.exitCode = 1;
        return;
      }
      console.log('config validation: OK');
      console.log(
        [
          '',
          'Next steps:',
          '  1. looper connect claude   (and/or: looper connect codex)',
          '  2. commit the scaffold and open a test issue',
          '  3. watch the dry-run previews, then promote loops one at a time:',
          '       looper promote groom --to act',
        ].join('\n'),
      );
    });
}

export async function buildScaffoldPlan(
  templatesDir: string,
  repoDir: string,
): Promise<ScaffoldPlan> {
  const files: PlannedFile[] = [];

  const add = async (source: string, targetRel: string) => {
    const target = join(repoDir, targetRel);
    const exists = await stat(target)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      files.push({ path: targetRel, source, action: 'create' });
      return;
    }
    const [current, template] = await Promise.all([
      readFile(target, 'utf8'),
      readFile(source, 'utf8'),
    ]);
    files.push({
      path: targetRel,
      source,
      action: current === template ? 'skip' : 'conflict',
    });
  };

  await add(join(templatesDir, 'looper.yml'), '.looper/looper.yml');
  const loopsDir = join(templatesDir, 'loops');
  for (const loop of (await readdir(loopsDir)).sort()) {
    for (const file of (await readdir(join(loopsDir, loop))).sort()) {
      await add(join(loopsDir, loop, file), join('.looper', 'loops', loop, file));
    }
  }
  for (const wf of (await readdir(join(templatesDir, 'workflows'))).sort()) {
    await add(join(templatesDir, 'workflows', wf), join('.github', 'workflows', wf));
  }

  // Per-loop behavior summary (parsed from the template loop.ymls).
  const { parse } = await import('yaml');
  const loops: ScaffoldPlan['loops'] = [];
  for (const loop of (await readdir(loopsDir)).sort()) {
    const raw = parse(await readFile(join(loopsDir, loop, 'loop.yml'), 'utf8')) as {
      name: string;
      transition: { from: string; to: string };
      trigger: { github_event?: string; action?: string[]; cron?: string };
      mode?: string;
    };
    loops.push({
      name: raw.name,
      transition: `${raw.transition.from} -> ${raw.transition.to}`,
      trigger: raw.trigger.cron
        ? `cron ${raw.trigger.cron}`
        : `${raw.trigger.github_event}.${(raw.trigger.action ?? []).join('|')}`,
      mode: raw.mode ?? 'dry-run (root default)',
    });
  }
  return { files, loops };
}

function renderPlan(plan: ScaffoldPlan): void {
  console.log('looper init plan:\n');
  for (const f of plan.files) {
    const mark = f.action === 'create' ? '+' : f.action === 'skip' ? '=' : '!';
    console.log(
      `  ${mark} ${f.path}${f.action === 'conflict' ? '   (exists with local edits — will NOT overwrite)' : ''}`,
    );
  }
  console.log('\nloops this attaches (all safe-by-default until promoted):\n');
  for (const l of plan.loops) {
    console.log(
      `  ${l.name.padEnd(10)} ${l.transition.padEnd(32)} on ${l.trigger.padEnd(28)} mode=${l.mode}`,
    );
  }
  void relative; // (kept for future path rendering)
}
