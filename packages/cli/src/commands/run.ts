import type { Command } from 'commander';
import {
  OctokitGitHub,
  parseRepoFromRemoteUrl,
  resolveGitHubAuth,
  ACTIONS_BOT,
} from '@looper/github';
import { TelemetryBranchStore, handleRun } from '@looper/runtime';
import type { RepoRef } from '@looper/core';
import { findTemplatesDir } from '../assets.js';

/**
 * `looper run` / `looper tail` (task 0070): trigger a loop now (optionally on
 * one issue, optionally forced dry-run) and watch recent runs. Trigger honors
 * the same gates as automated runs — `--dry-run` only tightens, never loosens.
 */
export function registerRun(program: Command): void {
  program
    .command('run')
    .argument('<loop>', 'loop name')
    .description('trigger one loop now (over an issue, or its whole from-state)')
    .option('--repo <owner/name>', 'target repo')
    .option('--path <dir>', 'checked-out repo root', '.')
    .option('--issue <n>', 'target a single issue/PR')
    .option('--dry-run', 'force dry-run for this invocation (tighten-only)', false)
    .action(
      async (
        loopName: string,
        opts: { repo?: string; path: string; issue?: string; dryRun: boolean },
      ) => {
        const repo = await resolveRepo(opts.repo);
        const auth = await resolveGitHubAuth();
        const gh = new OctokitGitHub({ token: auth.token });
        const result = await handleRun(
          {
            repoDir: opts.path,
            repo,
            gh,
            records: new TelemetryBranchStore(gh, repo),
            botLogin: ACTIONS_BOT.login,
            templatesDir: await findTemplatesDir().catch(() => undefined),
            ...(opts.dryRun ? { forceDryRun: true } : {}),
          } as Parameters<typeof handleRun>[0],
          loopName,
          opts.issue ? Number(opts.issue) : undefined,
        );
        if (!result.found) {
          console.error(`no loop named '${loopName}'`);
          process.exitCode = 2;
          return;
        }
        if (result.records.length === 0) {
          console.log(`${loopName}: no eligible item advanced (nothing to do, or gated/claimed).`);
          return;
        }
        for (const r of result.records) {
          console.log(
            `${r.loop} #${r.item.number}: ${r.outcome.status}` +
              (r.outcome.transition ? ` (${r.outcome.transition})` : ''),
          );
        }
      },
    );

  program
    .command('tail')
    .alias('watch')
    .description('poll recent runs until interrupted')
    .option('--repo <owner/name>', 'target repo')
    .option('--interval <seconds>', 'poll interval', '15')
    .option('--once', 'print one snapshot and exit (for scripts/tests)', false)
    .action(async (opts: { repo?: string; interval: string; once: boolean }) => {
      const repo = await resolveRepo(opts.repo);
      const auth = await resolveGitHubAuth();
      const gh = new OctokitGitHub({ token: auth.token });
      const store = new TelemetryBranchStore(gh, repo);
      const seen = new Set<string>();
      const poll = async () => {
        const today = new Date().toISOString().slice(0, 10);
        const records = (await store.readDay(today)).sort(
          (a, b) => Date.parse(a.trigger.at) - Date.parse(b.trigger.at),
        );
        for (const r of records) {
          if (seen.has(r.runId)) continue;
          seen.add(r.runId);
          console.log(
            `${r.trigger.at}  ${r.loop} #${r.item.number} [${r.backend}] ${r.outcome.status}` +
              (r.outcome.transition ? ` (${r.outcome.transition})` : ''),
          );
        }
      };
      await poll();
      if (opts.once) return;
      const ms = Math.max(5, Number(opts.interval)) * 1000;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        await poll();
      }
    });
}

async function resolveRepo(repoArg?: string): Promise<RepoRef> {
  if (repoArg) {
    const [owner, repo] = repoArg.split('/');
    if (!owner || !repo) throw new Error(`--repo must be owner/name, got '${repoArg}'`);
    return { owner, repo };
  }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['remote', 'get-url', 'origin']);
  const parsed = parseRepoFromRemoteUrl(stdout.trim());
  if (!parsed) throw new Error('cannot infer repo; pass --repo owner/name');
  return parsed;
}
