import type { Command } from 'commander';
import { readFile, appendFile } from 'node:fs/promises';
import { OctokitGitHub, resolveGitHubAuth, ACTIONS_BOT } from '@looper/github';
import { TelemetryBranchStore, handleEvent, handleSweep } from '@looper/runtime';
import type { ExecutionBackend } from '@looper/core';
import { findTemplatesDir } from '../assets.js';

/**
 * `looper controller event|sweep` — the entrypoint the reusable Actions
 * workflows invoke (tasks 0008/0076). Deterministic; uses the workflow's
 * GITHUB_TOKEN; one event or one sweep tick per invocation.
 */

export function registerController(
  program: Command,
  backends?: ReadonlyMap<string, ExecutionBackend>,
): void {
  const controller = program
    .command('controller')
    .description('controller entrypoints used by the Actions workflows');

  controller
    .command('event')
    .description('handle one GitHub event delivery')
    .requiredOption('--event-name <name>', 'GitHub event name (e.g. issues)')
    .requiredOption('--event-path <path>', 'path to the event payload JSON')
    .requiredOption('--repo <owner/name>', 'target repository')
    .option('--path <dir>', 'checked-out repo root', '.')
    .option('--dry-run', 'force dry-run for this invocation', false)
    .action(
      async (opts: {
        eventName: string;
        eventPath: string;
        repo: string;
        path: string;
        dryRun: boolean;
      }) => {
        const { gh, repo } = await connect(opts.repo);
        const payload = JSON.parse(await readFile(opts.eventPath, 'utf8')) as Record<
          string,
          unknown
        >;
        const result = await handleEvent(
          {
            repoDir: opts.path,
            repo,
            gh,
            ...(backends ? { backends } : {}),
            records: new TelemetryBranchStore(gh, repo),
            botLogin: ACTIONS_BOT.login,
            templatesDir: await findTemplatesDir().catch(() => undefined),
            ...(opts.dryRun ? { forceDryRun: true } : {}),
          } as Parameters<typeof handleEvent>[0],
          opts.eventName,
          payload,
        );
        const lines = [
          `event: ${opts.eventName} -> matched loops: ${result.matchedLoops.join(', ') || '(none)'}`,
          ...(result.intake ? ['intake: labeled new issue looper:state/new'] : []),
          ...result.records.map(
            (r) =>
              `  ${r.loop} #${r.item.number}: ${r.outcome.status}${r.outcome.transition ? ` (${r.outcome.transition})` : ''}`,
          ),
        ];
        console.log(lines.join('\n'));
        await jobSummary(['## looper event', ...lines]);
      },
    );

  controller
    .command('sweep')
    .description('run one reconcile-sweep tick')
    .requiredOption('--repo <owner/name>', 'target repository')
    .option('--path <dir>', 'checked-out repo root', '.')
    .option('--dry-run', 'force dry-run for this invocation', false)
    .action(async (opts: { repo: string; path: string; dryRun: boolean }) => {
      const { gh, repo } = await connect(opts.repo);
      const summary = await handleSweep({
        repoDir: opts.path,
        repo,
        gh,
        ...(backends ? { backends } : {}),
        records: new TelemetryBranchStore(gh, repo),
        botLogin: ACTIONS_BOT.login,
        templatesDir: await findTemplatesDir().catch(() => undefined),
        ...(opts.dryRun ? { forceDryRun: true } : {}),
      } as Parameters<typeof handleSweep>[0]);
      const lines = [
        `sweep: scanned ${summary.scannedStates.length} state(s), ` +
          `${summary.candidates} candidate(s), processed ${summary.processed.length}, ` +
          `reclaimed ${summary.reclaimedLeases} lease(s), deferred-by-cap ${summary.deferredByCap}`,
        ...summary.processed.map((p) => `  ${p.loop} #${p.item}: ${p.status}`),
        ...summary.skipped.slice(0, 20).map((s) => `  skip #${s.item}: ${s.reason}`),
      ];
      console.log(lines.join('\n'));
      await jobSummary(['## looper sweep', ...lines]);
    });
}

async function connect(
  repoArg: string,
): Promise<{ gh: OctokitGitHub; repo: { owner: string; repo: string } }> {
  const [owner, repo] = repoArg.split('/');
  if (!owner || !repo) throw new Error(`--repo must be owner/name, got '${repoArg}'`);
  const auth = await resolveGitHubAuth();
  return { gh: new OctokitGitHub({ token: auth.token }), repo: { owner, repo } };
}

async function jobSummary(lines: string[]): Promise<void> {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (!path) return;
  await appendFile(path, lines.join('\n') + '\n');
}
