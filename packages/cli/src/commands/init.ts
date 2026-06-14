import type { Command } from 'commander';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadConfig } from '@loopdog/config';
import { findTemplatesDir } from '../assets.js';
import { isLoopdogWorkflow, shortName } from './workflows.js';

/**
 * `loopdog init` (task 0007): attach loopdog to a repo — scaffold the root
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
    .description('attach loopdog to this repository (scaffold config + loops + workflows)')
    .option('--dry-run', 'preview only — write nothing', false)
    .option('--yes', 'non-interactive: accept and write the plan', false)
    .option('--force', 'offer to re-write conflicting files (still asks per file)', false)
    .option('--path <dir>', 'target repo root', '.')
    .option(
      '--no-enable-workflows',
      'skip re-enabling already-registered loopdog Actions workflows',
    )
    .action(
      async (opts: {
        dryRun: boolean;
        yes: boolean;
        force: boolean;
        path: string;
        enableWorkflows: boolean;
      }) => {
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

        // Safe by default means dry-run loops, NOT a disabled controller: the
        // events/sweep workflows must be ON or opened issues silently stall. On a
        // first attach they aren't registered yet (they register + start enabled on
        // first push); on a re-attach they may have been disabled — re-enable them.
        // Strictly best-effort: offline / no-auth / first-attach are soft notes,
        // never an init failure.
        if (opts.enableWorkflows) await enableScaffoldedWorkflows(opts.path);

        console.log(
          [
            '',
            'Next steps:',
            '  1. loopdog connect claude   (and/or: loopdog connect codex)',
            '  2. commit the scaffold and push (the workflows register + turn on)',
            '  3. open a test issue, watch the dry-run previews, then promote loops:',
            '       loopdog promote groom --to act',
            '  • toggle the driving workflows anytime: loopdog workflows [list|enable|disable]',
          ].join('\n'),
        );
      },
    );
}

/**
 * Best-effort: leave loopdog's Actions workflows enabled after an attach. Never
 * throws — a fresh attach has nothing registered yet, and offline/no-auth is a
 * soft note, so this can't turn `loopdog init` into a failure.
 */
async function enableScaffoldedWorkflows(repoDir: string): Promise<void> {
  try {
    const { OctokitGitHub, parseRepoFromRemoteUrl, resolveGitHubAuth } =
      await import('@loopdog/github');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', [
      '-C',
      repoDir,
      'remote',
      'get-url',
      'origin',
    ]);
    const repo = parseRepoFromRemoteUrl(stdout.trim());
    if (!repo) return;
    const auth = await resolveGitHubAuth();
    const gh = new OctokitGitHub({ token: auth.token });
    const registered = (await gh.listWorkflows(repo)).filter(isLoopdogWorkflow);
    if (registered.length === 0) {
      console.log(
        'workflows: none registered yet — they enable themselves on first push (`git push`).',
      );
      return;
    }
    const disabled = registered.filter((w) => w.state !== 'active');
    if (disabled.length === 0) {
      console.log('workflows: loopdog Actions already enabled.');
      return;
    }
    for (const w of disabled) await gh.enableWorkflow(repo, w.id);
    console.log(`workflows: re-enabled ${disabled.map(shortName).join(', ')}.`);
  } catch {
    // Offline, no gh auth, missing actions:write, or not a GitHub remote — the
    // dedicated command (`loopdog workflows enable`) covers it post-push.
  }
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

  await add(join(templatesDir, 'loopdog.yml'), '.loopdog/loopdog.yml');
  const loopsDir = join(templatesDir, 'loops');
  for (const loop of (await readdir(loopsDir)).sort()) {
    for (const file of (await readdir(join(loopsDir, loop))).sort()) {
      await add(join(loopsDir, loop, file), join('.loopdog', 'loops', loop, file));
    }
  }
  for (const wf of (await readdir(join(templatesDir, 'workflows'))).sort()) {
    // The self-hosted worker is the opt-in escape hatch — scaffolded only when
    // a self-hosted backend is configured (loopdog connect default self-hosted).
    if (wf === 'loopdog-self-hosted-worker.yml') continue;
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
  console.log('loopdog init plan:\n');
  for (const f of plan.files) {
    const mark = f.action === 'create' ? '+' : f.action === 'skip' ? '=' : '!';
    console.log(
      `  ${mark} ${f.path}${f.action === 'conflict' ? '   (exists with local edits — will NOT overwrite)' : ''}`,
    );
  }
  console.log('\nloops this attaches (all safe-by-default until promoted):\n');
  // Width columns to the actual content so names like `deploy-smoke` and long
  // trigger lists stay aligned instead of ragged.
  const nameW = Math.max(...plan.loops.map((l) => l.name.length));
  const transW = Math.max(...plan.loops.map((l) => l.transition.length));
  const trigW = Math.max(...plan.loops.map((l) => l.trigger.length));
  for (const l of plan.loops) {
    console.log(
      `  ${l.name.padEnd(nameW)}  ${l.transition.padEnd(transW)}  on ${l.trigger.padEnd(trigW)}  mode=${l.mode}`,
    );
  }
  void relative; // (kept for future path rendering)
}
