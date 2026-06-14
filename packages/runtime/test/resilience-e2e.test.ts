import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSweep } from '@loopdog/runtime';
import type { ControllerOptions } from '@loopdog/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore, VirtualClock } from '@loopdog/testing';
import { renderCriteriaBlock, stateLabel } from '@loopdog/core';
import { buildScaffoldPlan } from '../../cli/src/commands/init.js';

/**
 * Resilience & failure policy end-to-end (M19): the runtime honors the
 * `resilience:` knobs over the real controller + fakes — a poisoned item is
 * quarantined (never silently dropped) and escalated, a load spike defers at
 * the concurrency ceiling, and a provider outage trips the circuit breaker so
 * the loop stops dispatching during the cooldown.
 */

const repo = { owner: 'o', repo: 'r' };
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const GROOMED = [
  'Body.',
  renderCriteriaBlock([
    { text: 'works', validation: { kind: 'test', ref: 'a.test.ts' }, met: false },
  ]),
  '<!-- loopdog:scope -->bounded<!-- /loopdog:scope -->',
].join('\n');

/** Scaffold an act-mode repo with a custom `resilience:` block. */
async function scaffold(resilienceYaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loopdog-resil-'));
  dirs.push(dir);
  const templatesDir = fileURLToPath(new URL('../../../templates/', import.meta.url));
  const plan = await buildScaffoldPlan(templatesDir, dir);
  for (const file of plan.files) {
    const target = join(dir, file.path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await readFile(file.source, 'utf8'));
  }
  const rootYml = join(dir, '.loopdog', 'loopdog.yml');
  let yml = (await readFile(rootYml, 'utf8')).replace('mode: dry-run', 'mode: act');
  // Replace the whole resilience block (template lines) with the test's.
  yml = yml.replace(/resilience:\n(?: {2}.*\n)+/, resilienceYaml);
  await writeFile(rootYml, yml);
  return dir;
}

function makeWorld(repoDir: string) {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const records = new InMemoryRunRecordStore();
  const clock = new VirtualClock();
  const opts: ControllerOptions = {
    repoDir,
    repo,
    gh,
    backends: new Map([['claude', backend]]),
    records,
    botLogin: 'github-actions[bot]',
    now: clock.now,
    claimNonce: (() => {
      let n = 0;
      return () => `n${n++}`;
    })(),
  };
  return { gh, backend, records, clock, opts };
}

describe('resilience & failure policy (M19)', () => {
  it('quarantines a poisoned item after max_attempts_per_item and escalates (0091)', async () => {
    const repoDir = await scaffold(
      'resilience:\n  retries: { max: 0, backoff: exponential, base: 30s, cap: 10m }\n  max_attempts_per_item: 2\n  escalate_to: "@team/oncall"\n',
    );
    const { gh, backend, records, clock, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    backend.behavior = 'fail-dispatch'; // every dispatch is a provider failure
    gh.seedIssue({
      ref: { ...repo, number: 1 },
      body: GROOMED,
      labels: [stateLabel('ready-for-agent')],
    });

    // Attempt 1 → transient (backoff), then advance past the timer and retry.
    await handleSweep(opts);
    expect((await gh.getIssue({ ...repo, number: 1 })).labels).not.toContain('loopdog:quarantine');
    clock.advanceMinutes(15);
    // Attempt 2 → poisoned (max_attempts_per_item: 2) → quarantine + escalate.
    await handleSweep(opts);

    const issue = await gh.getIssue({ ...repo, number: 1 });
    expect(issue.labels).toContain('loopdog:quarantine');
    expect(issue.labels).toContain('loopdog:needs-human');
    const comments = await gh.listComments({ ...repo, number: 1 });
    expect(comments.some((c) => c.body.includes('@team/oncall'))).toBe(true);
    expect(comments.some((c) => c.body.includes('loopdog retry'))).toBe(true);
    expect(
      records.records.some(
        (r) => r.outcome.status === 'escalated' && r.outcome.failure?.class === 'poisoned',
      ),
    ).toBe(true);
  });

  it('defers new dispatches at the per-loop concurrency ceiling (0090)', async () => {
    const repoDir = await scaffold('resilience:\n  max_in_flight: { global: 10, per_loop: 2 }\n');
    const { gh, backend, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    backend.behavior = 'silent'; // dispatched items stay in flight (never ingest)
    for (const n of [1, 2, 3]) {
      gh.seedIssue({
        ref: { ...repo, number: n },
        body: GROOMED,
        labels: [stateLabel('ready-for-agent')],
      });
    }
    await handleSweep(opts);
    // Only `per_loop` (2) implement dispatches happen; the 3rd is deferred.
    expect(backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(2);
  });

  it('escalates a dispatch with no correlated PR by dispatch_timeout (0089)', async () => {
    const repoDir = await scaffold(
      'resilience:\n  retries: { max: 0, backoff: exponential, base: 30s, cap: 10m }\n  dispatch_timeout: 5m\n  max_attempts_per_item: 1\n',
    );
    const { gh, backend, records, clock, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    backend.behavior = 'silent'; // dispatches, but the work cell never opens a PR
    gh.seedIssue({
      ref: { ...repo, number: 1 },
      body: GROOMED,
      labels: [stateLabel('ready-for-agent')],
    });

    await handleSweep(opts); // dispatch → in-progress, pending, deadline stamped
    expect(backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(1);
    expect((await gh.getIssue({ ...repo, number: 1 })).labels).toContain(stateLabel('in-progress'));

    clock.advanceMinutes(6); // past the 5m dispatch_timeout
    await handleSweep(opts); // ingest still pending, but the deadline lapsed → timeout
    // max_attempts_per_item: 1 → the timed-out attempt is poisoned → quarantined.
    const issue = await gh.getIssue({ ...repo, number: 1 });
    expect(issue.labels).toContain('loopdog:quarantine');
    expect(
      records.records.some((r) => r.steps.some((s) => s.detail.includes('dispatch timeout'))),
    ).toBe(true);
  });

  it('trips the circuit breaker after consecutive provider failures and stops dispatching (0090)', async () => {
    const repoDir = await scaffold(
      'resilience:\n  retries: { max: 0, backoff: exponential, base: 30s, cap: 10m }\n  max_attempts_per_item: 9\n  circuit_breaker: { consecutive_failures: 2, cooldown: 1h }\n',
    );
    const { gh, backend, records, clock, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    backend.behavior = 'fail-dispatch';
    gh.seedIssue({
      ref: { ...repo, number: 1 },
      body: GROOMED,
      labels: [stateLabel('ready-for-agent')],
    });

    // `fail-dispatch` throws before counting, so the truthful "attempt admitted"
    // signal is a failure run-record (an open circuit emits none — it skips).
    const attempts = () =>
      records.records.filter(
        (r) =>
          r.loop === 'implement' &&
          (r.outcome.status === 'failed' || r.outcome.status === 'escalated'),
      ).length;

    await handleSweep(opts); // failure #1
    clock.advanceMinutes(15);
    await handleSweep(opts); // failure #2 → breaker opens
    const whenOpen = attempts();
    expect(whenOpen).toBe(2);
    clock.advanceMinutes(15); // still < 1h cooldown
    await handleSweep(opts); // circuit open → skipped, no new attempt
    expect(attempts()).toBe(whenOpen);
    // After the cooldown elapses, a single probe is admitted again.
    clock.advanceMinutes(60);
    await handleSweep(opts);
    expect(attempts()).toBe(whenOpen + 1);
  });
});
