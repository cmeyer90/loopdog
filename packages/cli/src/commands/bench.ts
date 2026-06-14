import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import type { RunRecord } from '@loopdog/core';
import { OctokitGitHub, resolveGitHubAuth } from '@loopdog/github';
import { TelemetryBranchStore, projectBenchmark, renderBenchmarkMarkdown } from '@loopdog/runtime';

/**
 * `loopdog bench` (task 0065): fold the run-record telemetry ledger into a
 * per-(loop, backend) cost/latency/success report — read-only, never dispatches
 * or mutates GitHub. Renders Markdown (default) or JSON to stdout or `--out`;
 * when `--out docs/benchmarks.md`, it replaces the table between the
 * `loopdog:benchmarks` markers without clobbering the surrounding prose.
 */
const OPEN = '<!-- loopdog:benchmarks -->';
const CLOSE = '<!-- /loopdog:benchmarks -->';

export function registerBench(program: Command): void {
  program
    .command('bench')
    .description('per-loop, per-provider cost/latency/success from the telemetry ledger')
    .option('--repo <owner/name>', 'target repo')
    .option('--since <days>', 'window in days', '30')
    .option('--loop <name>', 'restrict to one loop')
    .option('--backend <id>', 'restrict to one backend')
    .option('--format <fmt>', 'md | json', 'md')
    .option('--min-sample <n>', 'low-confidence threshold', '5')
    .option('--out <file>', 'write to a file instead of stdout')
    .action(
      async (opts: {
        repo?: string;
        since: string;
        loop?: string;
        backend?: string;
        format: string;
        minSample: string;
        out?: string;
      }) => {
        const records = await loadRecords(opts.repo, Math.max(1, Number(opts.since) || 30));
        const report = projectBenchmark(records, {
          minSample: Number(opts.minSample) || 5,
          ...(opts.loop ? { loop: opts.loop } : {}),
          ...(opts.backend ? { backend: opts.backend } : {}),
        });

        if (opts.format === 'json') {
          const json = JSON.stringify(report, null, 2);
          if (opts.out) await writeFile(opts.out, json + '\n');
          else console.log(json);
          return;
        }

        const table = renderBenchmarkMarkdown(report);
        if (!opts.out) {
          console.log(table);
          return;
        }
        // Markdown to a file: splice between the markers if they exist (preserve
        // the Methodology prose), else write a fresh doc.
        const existing = await readFile(opts.out, 'utf8').catch(() => '');
        const next =
          existing.includes(OPEN) && existing.includes(CLOSE)
            ? existing.replace(
                new RegExp(`${OPEN}[\\s\\S]*${CLOSE}`),
                `${OPEN}\n${table}\n${CLOSE}`,
              )
            : `# Benchmarks\n\n${OPEN}\n${table}\n${CLOSE}\n`;
        await writeFile(opts.out, next);
        console.log(`✓ wrote benchmarks to ${opts.out}`);
      },
    );
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
  const { parseRepoFromRemoteUrl } = await import('@loopdog/github');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['remote', 'get-url', 'origin']);
  const parsed = parseRepoFromRemoteUrl(stdout.trim());
  if (!parsed) throw new Error('cannot infer repo; pass --repo owner/name');
  return parsed;
}
