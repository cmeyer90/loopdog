import type { Command } from 'commander';
import type { RunRecord } from '@looper/core';
import { aggregateOutcomes } from '@looper/runtime';
import { OctokitGitHub, resolveGitHubAuth } from '@looper/github';
import { TelemetryBranchStore } from '@looper/runtime';

/**
 * `looper runs list|show` (task 0069): trace what ran — item, dispatched
 * brief, steps, provider session + PR, cost/quota, outcome. Reads the
 * run-record ledger (the `looper/telemetry` orphan branch); secret-scrubbing
 * is applied at the store's egress (M07), so records read here are clean.
 */
export function registerRuns(program: Command): void {
  const runs = program.command('runs').description('run history and tracing');

  runs
    .command('list')
    .description('recent runs (newest first)')
    .option('--repo <owner/name>', 'target repo')
    .option('--loop <loop>', 'filter by loop')
    .option('--item <n>', 'filter by item number')
    .option('--status <s>', 'filter by outcome status')
    .option('--since <days>', 'days back to scan', '7')
    .option('--limit <n>', 'max rows', '20')
    .option('--json', 'machine output', false)
    .action(async (opts: Record<string, string | boolean>) => {
      const records = await loadRecords(opts['repo'] as string | undefined, Number(opts['since']));
      let filtered = records;
      if (opts['loop']) filtered = filtered.filter((r) => r.loop === opts['loop']);
      if (opts['item']) filtered = filtered.filter((r) => r.item.number === Number(opts['item']));
      if (opts['status']) filtered = filtered.filter((r) => r.outcome.status === opts['status']);
      filtered = filtered
        .sort((a, b) => Date.parse(b.trigger.at) - Date.parse(a.trigger.at))
        .slice(0, Number(opts['limit']));
      if (opts['json']) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }
      if (filtered.length === 0) {
        console.log('no runs found (telemetry branch empty or filtered out)');
        return;
      }
      console.log(
        'RUN'.padEnd(24) +
          'LOOP'.padEnd(13) +
          'ITEM'.padEnd(7) +
          'BACKEND'.padEnd(13) +
          'STATUS  RESULT',
      );
      for (const r of filtered) {
        const result = r.outcome.artifacts?.pr
          ? `PR #${r.outcome.artifacts.pr}`
          : (r.outcome.transition ?? '');
        console.log(
          r.runId.padEnd(24) +
            r.loop.padEnd(13) +
            `#${r.item.number}`.padEnd(7) +
            r.backend.padEnd(13) +
            r.outcome.status.padEnd(8) +
            result,
        );
      }
    });

  runs
    .command('show')
    .argument('<run>', 'run id')
    .description('full trace: item, dispatched brief, steps, artifacts, cost')
    .option('--repo <owner/name>', 'target repo')
    .option('--since <days>', 'days back to scan', '30')
    .option('--json', 'machine output', false)
    .action(async (runId: string, opts: Record<string, string | boolean>) => {
      const records = await loadRecords(opts['repo'] as string | undefined, Number(opts['since']));
      const run = records.find((r) => r.runId === runId);
      if (!run) {
        console.error(`run '${runId}' not found in the last ${opts['since']} days`);
        process.exitCode = 2;
        return;
      }
      if (opts['json']) {
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      console.log(`Run ${run.runId}   loop: ${run.loop}   item: #${run.item.number}`);
      console.log(
        `  Backend:  ${run.backend}${run.mode && run.mode !== 'act' ? ` (mode=${run.mode})` : ''}`,
      );
      console.log(
        `  Trigger:  ${run.trigger.kind}${run.trigger.event ? ` ${run.trigger.event}` : ''} @ ${run.trigger.at}`,
      );
      console.log(
        `  Status:   ${run.outcome.status}${run.outcome.transition ? `   (${run.outcome.transition})` : ''}`,
      );
      const cost = [
        run.cost.routineRuns ? `${run.cost.routineRuns} routine runs` : null,
        run.cost.cloudTasks ? `${run.cost.cloudTasks} cloud tasks` : null,
        run.cost.usd ? `$${run.cost.usd}` : null,
      ].filter(Boolean);
      if (cost.length) console.log(`  Cost:     ${cost.join(', ')}`);
      if (run.briefRef) console.log(`  Brief:    ${run.briefRef}`);
      if (run.outcome.failure) {
        console.log(`  Failure:  [${run.outcome.failure.class}] ${run.outcome.failure.reason}`);
      }
      console.log('\n  Steps:');
      for (const s of run.steps) {
        console.log(`    ${s.t}  ${s.kind.padEnd(10)} ${s.detail}`);
      }
      const artifacts = [
        run.outcome.artifacts?.pr ? `PR #${run.outcome.artifacts.pr}` : null,
        run.outcome.artifacts?.plan ? `plan ${run.outcome.artifacts.plan}` : null,
        run.outcome.artifacts?.session ? `session ${run.outcome.artifacts.session}` : null,
      ].filter(Boolean);
      if (artifacts.length) console.log(`\n  Artifacts: ${artifacts.join(' · ')}`);
    });

  runs
    .command('stats')
    .description('per-loop × backend outcome aggregates (feeds routing)')
    .option('--repo <owner/name>', 'target repo')
    .option('--since <days>', 'days back to scan', '30')
    .option('--json', 'machine output', false)
    .action(async (opts: Record<string, string | boolean>) => {
      const records = await loadRecords(opts['repo'] as string | undefined, Number(opts['since']));
      const aggregates = aggregateOutcomes(records, 1);
      if (opts['json']) {
        console.log(JSON.stringify(aggregates, null, 2));
        return;
      }
      console.log('LOOP'.padEnd(13) + 'BACKEND'.padEnd(13) + 'RUNS  DONE  FAIL  SUCCESS%');
      for (const a of aggregates) {
        console.log(
          a.loop.padEnd(13) +
            a.backend.padEnd(13) +
            String(a.dispatches).padEnd(6) +
            String(a.done).padEnd(6) +
            String(a.failed).padEnd(6) +
            (a.successRate === null ? '—' : `${(a.successRate * 100).toFixed(0)}%`),
        );
      }
    });
}

async function loadRecords(repoArg: string | undefined, sinceDays: number): Promise<RunRecord[]> {
  const repo = await resolveRepo(repoArg);
  const auth = await resolveGitHubAuth();
  const gh = new OctokitGitHub({ token: auth.token });
  const store = new TelemetryBranchStore(gh, repo);
  const records: RunRecord[] = [];
  const now = Date.now();
  for (let back = 0; back < sinceDays; back++) {
    const day = new Date(now - back * 86_400_000).toISOString().slice(0, 10);
    records.push(...(await store.readDay(day)));
  }
  return records;
}

async function resolveRepo(repoArg: string | undefined): Promise<{ owner: string; repo: string }> {
  if (repoArg) {
    const [owner, repo] = repoArg.split('/');
    if (!owner || !repo) throw new Error(`--repo must be owner/name, got '${repoArg}'`);
    return { owner, repo };
  }
  const { parseRepoFromRemoteUrl } = await import('@looper/github');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['remote', 'get-url', 'origin']);
  const parsed = parseRepoFromRemoteUrl(stdout.trim());
  if (!parsed) throw new Error('cannot infer repo; pass --repo owner/name');
  return parsed;
}
