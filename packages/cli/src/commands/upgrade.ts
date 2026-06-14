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
} from '@loopdog/config';
import { retargetCallerWorkflow, type CallerPinChange } from './upgrade-workflows.js';
import { CLI_VERSION } from '../version.js';

const CLI_MAJOR = Number(CLI_VERSION.split('.')[0]);

/**
 * `loopdog upgrade` (task 0067): lift an attached `.loopdog/` tree from an older
 * config `version` to the one this loopdog understands, applying ordered,
 * idempotent migrations. Refuses a downgrade (newer on-disk) or a too-old tree;
 * a no-op when already current. Adopter-edited files are never silently
 * overwritten — a conflicting migration writes a `.loopdog-new` sidecar.
 *
 * It also re-syncs the scaffolded caller workflows' version pins to the floating
 * major (task 0100): a repo scaffolded by an older loopdog carries exact pins
 * that never move, so its deployed controller silently goes stale. That drift is
 * independent of the config `version`, so the sync runs even when the config is
 * already current.
 */
export function registerUpgrade(program: Command): void {
  program
    .command('upgrade')
    .description('migrate the .loopdog/ tree + re-sync controller workflow pins forward')
    .option('--path <dir>', 'repo root', '.')
    .option('--dry-run', 'preview migrations + the per-file table; write nothing', false)
    .action(async (opts: { path: string; dryRun: boolean }) => {
      const loopdogDir = join(opts.path, '.loopdog');
      const rootYml = join(loopdogDir, 'loopdog.yml');
      let onDisk: number;
      try {
        const raw = parse(await readFile(rootYml, 'utf8')) as { version?: number };
        onDisk = typeof raw?.version === 'number' ? raw.version : 1;
      } catch {
        console.error(`no .loopdog/loopdog.yml at ${loopdogDir} — run \`loopdog init\` first.`);
        process.exitCode = 2;
        return;
      }

      // --- config tree migration ---
      const plan = planUpgrade(onDisk);
      if (!plan.ok) {
        // 'ahead' (downgrade) or 'too-old' — incompatible; don't touch anything.
        console.error(`refused: ${plan.reason}`);
        process.exitCode = 1;
        return;
      }
      if (plan.status === 'current') {
        console.log(`✓ config already current (version ${onDisk}).`);
      } else {
        const before = await readTree(loopdogDir);
        const after = migrateTree(before, onDisk);
        const changed = Object.entries(after).filter(([p, c]) => before[p] !== c);
        console.log(
          `${opts.dryRun ? 'would migrate' : 'migrating'} config version ${onDisk} → ${CONFIG_VERSION} ` +
            `(${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}):`,
        );
        for (const s of plan.steps) console.log(`  - ${s.from}→${s.to}: ${s.description}`);
        for (const [p] of changed) console.log(`  ~ .loopdog/${p}`);
        if (!opts.dryRun) {
          for (const [p, content] of changed) await writeFile(join(loopdogDir, p), content);
        }
      }

      // --- caller-workflow version pins (task 0100) ---
      const wfChanges = await syncCallerWorkflows(opts.path, CLI_MAJOR, opts.dryRun);
      if (wfChanges.length === 0) {
        console.log(`✓ controller workflows already track @v${CLI_MAJOR} (no pin drift).`);
      } else {
        console.log(
          `${opts.dryRun ? 'would re-sync' : 're-synced'} controller workflow pins ` +
            `→ @v${CLI_MAJOR} / loopdog-version '${CLI_MAJOR}' (auto-tracks the latest ${CLI_MAJOR}.x):`,
        );
        for (const f of wfChanges)
          for (const c of f.changes) console.log(`  ~ ${f.file}: ${c.field} ${c.from} → ${c.to}`);
      }

      if (opts.dryRun) {
        console.log('(dry-run — nothing written.)');
        return;
      }
      console.log('done — review + commit the diff.');
    });
}

/**
 * Re-sync every scaffolded loopdog caller workflow under `.github/workflows/` to
 * the floating major. Skips non-loopdog files and the custom deploy workflow
 * (which carries no reusable ref). Writes only when not a dry-run.
 */
async function syncCallerWorkflows(
  repoDir: string,
  major: number,
  dryRun: boolean,
): Promise<Array<{ file: string; changes: CallerPinChange[] }>> {
  const wfDir = join(repoDir, '.github', 'workflows');
  let entries: string[];
  try {
    entries = await readdir(wfDir);
  } catch {
    return []; // no .github/workflows (e.g. self-hosted only) — nothing to sync
  }
  const results: Array<{ file: string; changes: CallerPinChange[] }> = [];
  for (const name of entries.sort()) {
    if (!name.startsWith('loopdog-') || !/\.ya?ml$/.test(name)) continue;
    const abs = join(wfDir, name);
    const content = await readFile(abs, 'utf8');
    const { content: next, changes } = retargetCallerWorkflow(content, major);
    if (changes.length === 0) continue;
    if (!dryRun) await writeFile(abs, next);
    results.push({ file: join('.github', 'workflows', name), changes });
  }
  return results;
}

/** Read the `.loopdog/` subtree into a path → content map (paths relative to it). */
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
