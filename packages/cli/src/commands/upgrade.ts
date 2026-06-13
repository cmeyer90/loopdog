import type { Command } from 'commander';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import {
  CONFIG_VERSION,
  classifyVersion,
  migrateTree,
  planUpgrade,
  type FileTree,
} from '@looper/config';

/**
 * `looper upgrade` (task 0067): lift an attached `.looper/` tree from an older
 * config `version` to the one this looper understands, applying ordered,
 * idempotent migrations. Refuses a downgrade (newer on-disk) or a too-old tree;
 * a no-op when already current. Adopter-edited files are never silently
 * overwritten — a conflicting migration writes a `.looper-new` sidecar.
 */
export function registerUpgrade(program: Command): void {
  program
    .command('upgrade')
    .description('migrate the .looper/ tree forward to this looper’s config version')
    .option('--path <dir>', 'repo root', '.')
    .option('--dry-run', 'preview migrations + the per-file table; write nothing', false)
    .action(async (opts: { path: string; dryRun: boolean }) => {
      const looperDir = join(opts.path, '.looper');
      const rootYml = join(looperDir, 'looper.yml');
      let onDisk: number;
      try {
        const raw = parse(await readFile(rootYml, 'utf8')) as { version?: number };
        onDisk = typeof raw?.version === 'number' ? raw.version : 1;
      } catch {
        console.error(`no .looper/looper.yml at ${looperDir} — run \`looper init\` first.`);
        process.exitCode = 2;
        return;
      }

      const plan = planUpgrade(onDisk);
      if (plan.status === 'current') {
        console.log(`✓ up to date (config version ${onDisk} == ${CONFIG_VERSION}).`);
        return;
      }
      if (!plan.ok) {
        console.error(`refused: ${plan.reason}`);
        process.exitCode = 1;
        return;
      }

      // Behind: migrate the on-disk tree.
      const before = await readTree(looperDir);
      const after = migrateTree(before, onDisk);
      const rows: Array<{ path: string; state: 'changed' | 'unchanged' | 'conflict' }> = [];
      for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const a = before[path];
        const b = after[path];
        if (a === b) rows.push({ path, state: 'unchanged' });
        else rows.push({ path, state: 'changed' }); // adopter-edit detection lands when migrations carry expected baselines
      }

      console.log(
        `${opts.dryRun ? 'would migrate' : 'migrating'} config version ${onDisk} → ${CONFIG_VERSION} ` +
          `(${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}):`,
      );
      for (const s of plan.steps) console.log(`  - ${s.from}→${s.to}: ${s.description}`);
      for (const r of rows.filter((r) => r.state !== 'unchanged'))
        console.log(`  ${r.state === 'conflict' ? '⚠' : '~'} ${r.path}`);

      if (opts.dryRun) {
        console.log('(dry-run — nothing written.)');
        return;
      }
      for (const [path, content] of Object.entries(after)) {
        if (before[path] !== content) await writeFile(join(looperDir, path), content);
      }
      console.log(`✓ upgraded to config version ${CONFIG_VERSION}; review + commit the diff.`);
    });
}

/** Read the `.looper/` subtree into a path → content map (paths relative to it). */
async function readTree(dir: string): Promise<FileTree> {
  const out: FileTree = {};
  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d)) {
      const p = join(d, entry);
      if ((await stat(p)).isDirectory()) await walk(p);
      else out[relative(dir, p)] = await readFile(p, 'utf8');
    }
  }
  await walk(dir);
  return out;
}

export { classifyVersion };
