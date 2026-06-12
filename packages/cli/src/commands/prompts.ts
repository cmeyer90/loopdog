import type { Command } from 'commander';
import { loadConfig } from '@looper/config';
import { compose, createFsPromptSource, lintPrompt, resolveArtifact } from '@looper/runtime';
import type { ComposeContext } from '@looper/runtime';
import { findTemplatesDir } from '../assets.js';

/**
 * `looper prompts show|diff|lint` (tasks 0022/0072): see exactly what would be
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
        branch: `looper/${loop.name}/<issue>-<run-id>`,
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
        console.error('config invalid — fix `looper config validate` first.');
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
