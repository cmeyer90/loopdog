import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@loopdog/config';
import { DEFAULT_STATES, OFF_RAMP_LABELS, QUARANTINE_LABEL, stateLabel } from '@loopdog/core';
import { aggregateOutcomes, TelemetryBranchStore } from '@loopdog/runtime';
import { OctokitGitHub, parseRepoFromRemoteUrl, resolveGitHubAuth } from '@loopdog/github';
import type { GitHubPort, RepoRef, RunRecord } from '@loopdog/core';

/**
 * `loopdog status` + control verbs (task 0071): the fleet overview (pipeline
 * counts, attention list, 24h throughput, quota burn) and the explicit
 * control surface (pause/resume, stop/resume-all kill switch, budget set,
 * loops set). Control actions honor the same safety gates as automated runs
 * and are audited as a one-line YAML diff (everything-as-artifact).
 */
export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('fleet overview: pipeline counts, attention list, throughput, quota')
    .option('--repo <owner/name>', 'target repo')
    .option('--path <dir>', 'repo root', '.')
    .option('--json', 'machine output', false)
    .action(async (opts: { repo?: string; path: string; json: boolean }) => {
      const config = await loadConfig(opts.path);
      const { gh, repo } = await connect(opts.repo);
      const counts: Record<string, number> = {};
      for (const state of DEFAULT_STATES) {
        const items = await gh.listIssuesByLabel(repo, stateLabel(state));
        if (items.length) counts[state] = items.length;
      }
      const attention: Record<string, number> = {};
      // Off-ramps + the resilience holds (quarantine, approval) — anything
      // waiting on a human (M19 · 0091).
      for (const label of [...OFF_RAMP_LABELS, QUARANTINE_LABEL, 'loopdog:needs-approval']) {
        const items = await gh.listIssuesByLabel(repo, label);
        if (items.length) attention[label] = items.length;
      }
      const records = await loadRecentRecords(gh, repo, 1);
      const done = records.filter((r) => r.outcome.status === 'done').length;
      const failed = records.filter(
        (r) => r.outcome.status === 'failed' || r.outcome.status === 'escalated',
      ).length;
      const killSwitch = Boolean(
        process.env[config.config?.root.kill_switch.variable ?? 'LOOPDOG_KILL'],
      );

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              repo,
              killSwitch,
              pipeline: counts,
              attention,
              throughput: { runs24h: records.length, done, failed },
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        `${repo.owner}/${repo.repo}   loops: ${config.config?.loops.length ?? '?'}   ` +
          `kill-switch: ${killSwitch ? 'ON' : 'OFF'}`,
      );
      console.log('\nPIPELINE');
      for (const [state, n] of Object.entries(counts)) console.log(`  ${state.padEnd(18)} ${n}`);
      if (Object.keys(attention).length) {
        console.log('\nATTENTION');
        for (const [label, n] of Object.entries(attention))
          console.log(`  ${label.padEnd(22)} ${n}`);
      }
      console.log(`\nRecent: ${records.length} runs/24h · ${done} ✓ · ${failed} ✗`);
      void aggregateOutcomes;
    });

  // ---- control verbs ----

  program
    .command('stop')
    .description('global kill switch ON — halt all dispatch')
    .option('--repo <owner/name>', 'target repo')
    .action(async (opts: { repo?: string }) => {
      const { repo } = await connect(opts.repo);
      await setRepoVariable(repo, 'LOOPDOG_KILL', '1');
      console.log('■ kill switch ON — all loops halted. Resume with `loopdog resume-all`.');
    });

  program
    .command('resume-all')
    .description('clear the global kill switch')
    .option('--repo <owner/name>', 'target repo')
    .action(async (opts: { repo?: string }) => {
      const { repo } = await connect(opts.repo);
      await setRepoVariable(repo, 'LOOPDOG_KILL', '');
      console.log('▶ kill switch OFF — loops may dispatch again.');
    });

  program
    .command('pause')
    .argument('<loop>', 'loop name')
    .description('pause a loop (sets its mode to dry-run; observe-only)')
    .option('--path <dir>', 'repo root', '.')
    .action((loop: string, opts: { path: string }) =>
      setLoopMode(loop, 'dry-run', opts.path, 'paused'),
    );

  program
    .command('resume')
    .argument('<loop>', 'loop name')
    .description('resume a paused loop back to act')
    .option('--path <dir>', 'repo root', '.')
    .action((loop: string, opts: { path: string }) =>
      setLoopMode(loop, 'act', opts.path, 'resumed'),
    );

  program
    .command('approve')
    .argument('<item>', 'issue/PR number to release')
    .description('release a parked item (apply loopdog:approved as you, a trusted actor)')
    .option('--repo <owner/name>', 'target repo')
    .action(async (item: string, opts: { repo?: string }) => {
      const { gh, repo } = await connect(opts.repo);
      const ref = { ...repo, number: Number(item) };
      const labels = await gh.getItemLabels(ref);
      if (!labels.includes('loopdog:needs-approval')) {
        console.log(`#${item} is not held for approval — nothing to release.`);
        return;
      }
      await gh.addLabels(ref, ['loopdog:approved']);
      await gh.removeLabel(ref, 'loopdog:needs-approval');
      const who = await gh.getAuthenticatedActor();
      await gh.createComment(ref, `✅ loopdog: released by ${who.login} via \`loopdog approve\`.`);
      console.log(`✓ released #${item} (loopdog:approved applied; hold cleared).`);
    });

  program
    .command('retry')
    .argument('<item>', 'issue/PR number to release from quarantine')
    .description('release a quarantined item: clear quarantine + needs-human + attempt counters')
    .option('--repo <owner/name>', 'target repo')
    .action(async (item: string, opts: { repo?: string }) => {
      const { gh, repo } = await connect(opts.repo);
      const ref = { ...repo, number: Number(item) };
      const labels = await gh.getItemLabels(ref);
      if (!labels.includes(QUARANTINE_LABEL) && !labels.includes('loopdog:needs-human')) {
        console.log(`#${item} is not quarantined/escalated — nothing to retry.`);
        return;
      }
      // Drop the holds + the failure bookkeeping so the sweep re-attempts cleanly.
      for (const l of labels) {
        if (
          l === QUARANTINE_LABEL ||
          l === 'loopdog:needs-human' ||
          l.startsWith('loopdog:attempts/') ||
          l.startsWith('loopdog:not-before/')
        ) {
          await gh.removeLabel(ref, l);
        }
      }
      const who = await gh.getAuthenticatedActor();
      await gh.createComment(
        ref,
        `🔄 loopdog: released from quarantine by ${who.login} via \`loopdog retry\` — attempts reset.`,
      );
      console.log(`✓ released #${item} from quarantine (attempt counters cleared).`);
    });

  const budget = program.command('budget').description('budget/quota controls');
  budget
    .command('set')
    .description('set global budget ceilings in loopdog.yml')
    .option('--path <dir>', 'repo root', '.')
    .option('--daily <n>', 'max dispatches per window')
    .option('--usd <n>', 'max usd per window')
    .action(async (opts: { path: string; daily?: string; usd?: string }) => {
      const file = join(opts.path, '.loopdog', 'loopdog.yml');
      let text = await readFile(file, 'utf8');
      if (opts.daily !== undefined) {
        text = upsertYamlScalar(
          text,
          /(global:\s*\{[^}]*max_dispatches:\s*)\d+/,
          `$1${opts.daily}`,
        );
      }
      if (opts.usd !== undefined) {
        text = upsertYamlScalar(text, /(global:\s*\{[^}]*max_usd:\s*)\d+/, `$1${opts.usd}`);
      }
      await writeFile(file, text);
      const result = await loadConfig(opts.path);
      if (!result.ok) {
        console.error('budget edit left the config invalid — review .loopdog/loopdog.yml');
        process.exitCode = 1;
        return;
      }
      console.log(`✓ budget updated (${file}); commit the diff (audit trail).`);
    });
}

async function setLoopMode(
  loopName: string,
  mode: string,
  path: string,
  verb: string,
): Promise<void> {
  const file = join(path, '.loopdog', 'loops', loopName, 'loop.yml');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    console.error(`no loop '${loopName}' at ${file}`);
    process.exitCode = 2;
    return;
  }
  // tier:core merge loops can never be auto-resumed to act (graduated autonomy).
  if (mode === 'act' && /tier:\s*core/.test(text) && /to:\s*merged/.test(text)) {
    console.error(`refused: '${loopName}' is a tier:core merge loop — it stays human-gated`);
    process.exitCode = 1;
    return;
  }
  text = /^mode:\s*\S+.*$/m.test(text)
    ? text.replace(/^mode:\s*\S+(.*)$/m, `mode: ${mode}$1`)
    : text.trimEnd() + `\nmode: ${mode}\n`;
  await writeFile(file, text);
  console.log(`✓ ${verb} '${loopName}' (mode → ${mode}); commit the diff (audit trail).`);
}

function upsertYamlScalar(text: string, re: RegExp, replacement: string): string {
  return re.test(text) ? text.replace(re, replacement) : text;
}

async function connect(repoArg?: string): Promise<{ gh: GitHubPort; repo: RepoRef }> {
  const repo = await resolveRepo(repoArg);
  const auth = await resolveGitHubAuth();
  return { gh: new OctokitGitHub({ token: auth.token }), repo };
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

async function loadRecentRecords(
  gh: GitHubPort,
  repo: RepoRef,
  days: number,
): Promise<RunRecord[]> {
  const store = new TelemetryBranchStore(gh, repo);
  const records: RunRecord[] = [];
  const now = Date.now();
  for (let back = 0; back < days; back++) {
    const day = new Date(now - back * 86_400_000).toISOString().slice(0, 10);
    records.push(...(await store.readDay(day)));
  }
  return records;
}

async function setRepoVariable(repo: RepoRef, name: string, value: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    if (value === '') {
      await run('gh', ['variable', 'delete', name, '--repo', `${repo.owner}/${repo.repo}`]);
    } else {
      await run('gh', [
        'variable',
        'set',
        name,
        '--repo',
        `${repo.owner}/${repo.repo}`,
        '--body',
        value,
      ]);
    }
  } catch {
    console.error(
      `could not set repo variable ${name} via gh — set it manually in Settings → ` +
        'Secrets and variables → Actions → Variables.',
    );
    process.exitCode = 3;
  }
}
