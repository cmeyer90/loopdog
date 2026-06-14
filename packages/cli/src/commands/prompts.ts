import type { Command } from 'commander';
import { loadConfig } from '@loopdog/config';
import { compose, createFsPromptSource, lintPrompt, resolveArtifact } from '@loopdog/runtime';
import type { ComposeContext } from '@loopdog/runtime';
import { findTemplatesDir } from '../assets.js';

/**
 * `loopdog prompts show|diff|lint` (tasks 0022/0072): see exactly what would be
 * sent before it spends quota; diff adopter overrides against built-ins; lint
 * placeholders, policy refs, and secret literals.
 */
export function registerPrompts(program: Command): void {
  const prompts = program.command('prompts').description('inspect loop briefs and policies');

  prompts
    .command('show')
    .argument('<loop>', 'loop name')
    .option('--backend <name>', 'backend overlay to resolve')
    .option('--path <dir>', 'repo root', '.')
    .description('print the exact composed brief (with a sample item context)')
    .action(async (loopName: string, opts: { backend?: string; path: string }) => {
      const { loop, source } = await load(loopName, opts.path);
      if (!loop) return;
      const ctx: ComposeContext = {
        issue: { number: 0, title: '<sample issue title>', body: '<sample issue body>' },
        acceptanceCriteria: '- [ ] <sample criterion> (test: sample.test.ts)',
        transition: loop.transition,
        runId: 'run-<sample>',
        loop: loop.name,
        backend: opts.backend ?? loop.backend,
        branch: `loopdog/${loop.name}/<issue>-<run-id>`,
        repo: { defaultBranch: 'main' },
        adapter: {},
      };
      const brief = await compose(ctx, source);
      console.log(`# brief ${brief.ref} (policies: ${brief.policies.join(', ')})\n`);
      console.log(brief.text);
    });

  prompts
    .command('diff')
    .argument('<loop>', 'loop name')
    .option('--path <dir>', 'repo root', '.')
    .description('diff the adopter prompt against the built-in default')
    .action(async (loopName: string, opts: { path: string }) => {
      const { source } = await load(loopName, opts.path, { requireLoop: false });
      const [builtin, repo] = await Promise.all([source.builtin(loopName), source.repo(loopName)]);
      if (repo === null) {
        console.log('no adopter override — the built-in prompt is in effect.');
        return;
      }
      if (builtin === null) {
        console.log('adopter-authored prompt (no built-in default exists):\n');
        console.log(repo);
        return;
      }
      if (builtin === repo) {
        console.log('adopter prompt is identical to the built-in.');
        return;
      }
      const a = builtin.split('\n');
      const b = repo.split('\n');
      console.log('--- built-in\n+++ adopter override');
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (a[i] === b[i]) continue;
        if (a[i] !== undefined) console.log(`- ${a[i]}`);
        if (b[i] !== undefined) console.log(`+ ${b[i]}`);
      }
    });

  prompts
    .command('lint')
    .option('--path <dir>', 'repo root', '.')
    .description('lint every loop prompt (placeholders, policy refs, secret literals)')
    .action(async (opts: { path: string }) => {
      const result = await loadConfig(opts.path);
      if (!result.ok || !result.config) {
        console.error('config invalid — fix `loopdog config validate` first.');
        process.exitCode = 1;
        return;
      }
      const templatesDir = await findTemplatesDir().catch(() => undefined);
      const source = createFsPromptSource(opts.path, templatesDir);
      let failed = false;
      for (const loop of result.config.loops) {
        const artifact = await resolveArtifact(source, loop.name, loop.backend).catch(() => null);
        if (!artifact) {
          console.error(`${loop.name}: no prompt artifact`);
          failed = true;
          continue;
        }
        const issues = await lintPrompt(artifact.body, source);
        for (const issue of issues) {
          console.error(`${loop.name}: ${issue.rule}: ${issue.detail}`);
          failed = true;
        }
      }
      if (failed) process.exitCode = 1;
      else console.log('prompts lint: OK');
    });

  prompts
    .command('edit')
    .argument('<loop>', 'loop name')
    .option('--path <dir>', 'repo root', '.')
    .description('open the loop prompt in $EDITOR (git history is the version log)')
    .action(async (loopName: string, opts: { path: string }) => {
      const { join } = await import('node:path');
      const { access } = await import('node:fs/promises');
      const file = join(opts.path, '.loopdog', 'loops', loopName, 'prompt.md');
      try {
        await access(file);
      } catch {
        console.error(`no prompt at ${file} (run \`loopdog loops new ${loopName}\` first)`);
        process.exitCode = 2;
        return;
      }
      const editor = process.env['EDITOR'] ?? process.env['VISUAL'];
      if (!editor || !process.stdin.isTTY) {
        console.log(`edit this file: ${file}`);
        console.log(
          '(set $EDITOR to open it directly; commit the change — the diff is the audit trail)',
        );
        return;
      }
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve) => {
        const child = spawn(editor, [file], { stdio: 'inherit' });
        child.on('exit', () => resolve());
      });
      console.log(
        `✓ edited ${file}; \`loopdog prompts lint\` then commit (the diff is the version log).`,
      );
    });

  prompts
    .command('history')
    .argument('<loop>', 'loop name')
    .option('--path <dir>', 'repo root', '.')
    .option('--limit <n>', 'max commits', '10')
    .description('git history of the loop prompt (prompts are versioned artifacts)')
    .action(async (loopName: string, opts: { path: string; limit: string }) => {
      const relPath = `.loopdog/loops/${loopName}/prompt.md`;
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      try {
        const { stdout } = await promisify(execFile)('git', [
          '-C',
          opts.path,
          'log',
          `-n${opts.limit}`,
          '--pretty=format:%h %ad %an  %s',
          '--date=short',
          '--',
          relPath,
        ]);
        if (!stdout.trim()) {
          console.log(`no committed history for ${relPath} yet`);
          return;
        }
        console.log(stdout);
      } catch {
        console.error(`could not read git history for ${relPath} (is this a git repo?)`);
        process.exitCode = 1;
      }
    });
}

async function load(loopName: string, path: string, opts: { requireLoop?: boolean } = {}) {
  const templatesDir = await findTemplatesDir().catch(() => undefined);
  const source = createFsPromptSource(path, templatesDir);
  const result = await loadConfig(path);
  const loop = result.config?.loops.find((l) => l.name === loopName);
  if (!loop && opts.requireLoop !== false) {
    console.error(`no loop named '${loopName}'`);
    process.exitCode = 2;
    return { loop: undefined, source };
  }
  return { loop, source };
}
