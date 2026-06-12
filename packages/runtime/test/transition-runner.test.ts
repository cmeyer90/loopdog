import { describe, expect, it } from 'vitest';
import { runLoopOnce } from '@looper/runtime';
import type { RunnerDeps } from '@looper/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@looper/testing';
import { DEFAULT_TRANSITION_TABLE, renderCriteriaBlock, stateLabel } from '@looper/core';
import type { LoopDefinition, TriggerEvent } from '@looper/core';

const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };
const CRON: TriggerEvent = { kind: 'cron', deliveredAt: '2026-06-09T12:00:00Z' };

const GROOMED_BODY = [
  'Add rate limiting.',
  renderCriteriaBlock([
    { text: 'limits at 100 req/min', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
  ]),
  '<!-- looper:scope -->only api/ratelimit<!-- /looper:scope -->',
].join('\n\n');

function setup(loopPatch: Partial<LoopDefinition> = {}) {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const records = new InMemoryRunRecordStore();
  const loop: LoopDefinition = {
    name: 'implement',
    trigger: { kind: 'github_event', events: ['issues.labeled'] },
    transition: { from: 'ready-for-agent', to: 'in-review' },
    backend: 'claude',
    gates: { requireDor: true, requireCi: true, tier: 'default' },
    promptPath: '.looper/loops/implement/prompt.md',
    mode: 'act',
    expects: 'pull-request',
    ...loopPatch,
  };
  const deps: RunnerDeps = {
    gh,
    backends: new Map([['claude', backend]]),
    records,
    table: DEFAULT_TRANSITION_TABLE,
    readPrompt: async () => 'You are the implementation work cell.',
    botLogin: 'github-actions[bot]',
  };
  return { gh, backend, records, loop, deps };
}

describe('transition runner (0012) — work-cell loop', () => {
  it('dispatches once, persists the handle, marks in-progress; later invocation ingests to in-review', async () => {
    const { gh, backend, records, loop, deps } = setup();
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('ready-for-agent')] });

    // Invocation 1: dispatch phase.
    const first = await runLoopOnce(deps, loop, repo, CRON);
    expect(first).toHaveLength(1);
    expect(first[0]!.outcome.status).toBe('pending');
    expect(backend.dispatched).toHaveLength(1);
    expect(backend.dispatched[0]!.instructions).toContain('looper-run:');

    const afterDispatch = await gh.getIssue(ref);
    expect(afterDispatch.labels).toContain(stateLabel('in-progress'));
    expect(afterDispatch.labels).not.toContain(stateLabel('ready-for-agent'));
    const comments = await gh.listComments(ref);
    expect(comments.some((c) => c.body.includes('looper:dispatch'))).toBe(true);

    // Invocation 2 (sweep finds it in in-progress? — runner ingests via the
    // pending marker regardless of which state the sweep saw it in).
    const second = await runLoopOnce(deps, loop, repo, {
      kind: 'event',
      name: 'pull_request.opened',
      item: ref,
      deliveredAt: 'now',
    });
    expect(second).toHaveLength(1);
    expect(second[0]!.outcome.status).toBe('done');
    expect(second[0]!.outcome.transition).toBe('ready-for-agent->in-review');
    expect(second[0]!.outcome.artifacts?.pr).toBeDefined();

    const done = await gh.getIssue(ref);
    expect(done.labels).toContain(stateLabel('in-review'));
    expect(done.labels.filter((l) => l.startsWith('looper:claimed-by/'))).toEqual([]);
    expect(done.assignees).toEqual([]);

    // Invocation 3: nothing left to do (idempotent end state).
    const third = await runLoopOnce(deps, loop, repo, CRON);
    expect(third).toEqual([]);
    expect(backend.dispatched).toHaveLength(1); // never double-dispatched
    expect(records.records.map((r) => r.outcome.status)).toEqual(['pending', 'done']);
  });

  it('event and sweep racing on the same item dispatch exactly once', async () => {
    const { gh, backend, loop, deps } = setup();
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('ready-for-agent')] });
    const event: TriggerEvent = {
      kind: 'event',
      name: 'issues.labeled',
      item: ref,
      deliveredAt: 'now',
    };
    await Promise.all([runLoopOnce(deps, loop, repo, event), runLoopOnce(deps, loop, repo, CRON)]);
    expect(backend.dispatched).toHaveLength(1);
    const comments = await gh.listComments(ref);
    expect(comments.filter((c) => c.body.includes('looper:dispatch ')).length).toBe(1);
  });

  it('a silent work cell keeps the item pending (no stranding, no re-dispatch)', async () => {
    const { gh, backend, loop, deps } = setup();
    backend.behavior = 'silent';
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('ready-for-agent')] });
    await runLoopOnce(deps, loop, repo, CRON);
    const again = await runLoopOnce(deps, loop, repo, CRON);
    expect(again).toEqual([]); // ingest pending → no record spam
    expect(backend.dispatched).toHaveLength(1);
  });

  it('routes an ungroomed item back to needs-grooming (DoR gate)', async () => {
    const { gh, loop, deps } = setup();
    gh.seedIssue({ ref, body: 'vague request', labels: [stateLabel('ready-for-agent')] });
    const records = await runLoopOnce(deps, loop, repo, CRON);
    expect(records[0]!.outcome.transition).toBe('ready-for-agent->needs-grooming');
    const issue = await gh.getIssue(ref);
    expect(issue.labels).toContain(stateLabel('needs-grooming'));
    expect((await gh.listComments(ref)).some((c) => c.body.includes('routed'))).toBe(true);
  });

  it('dispatch failure releases the claim and escalates after max attempts', async () => {
    const { gh, backend, loop, deps } = setup();
    backend.behavior = 'fail-dispatch';
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('ready-for-agent')] });

    const r1 = await runLoopOnce({ ...deps, maxAttempts: 2 }, loop, repo, CRON);
    expect(r1[0]!.outcome.status).toBe('failed');
    let issue = await gh.getIssue(ref);
    expect(issue.labels.filter((l) => l.startsWith('looper:claimed-by/'))).toEqual([]);
    expect(issue.labels).toContain('looper:attempts/1');

    const r2 = await runLoopOnce({ ...deps, maxAttempts: 2 }, loop, repo, CRON);
    expect(r2[0]!.outcome.status).toBe('escalated');
    issue = await gh.getIssue(ref);
    expect(issue.labels).toContain('looper:needs-human');

    // Escalated item is no longer driven.
    const r3 = await runLoopOnce({ ...deps, maxAttempts: 2 }, loop, repo, CRON);
    expect(r3).toEqual([]);
  });
});

describe('transition runner (0012) — deterministic loop', () => {
  const detLoop: Partial<LoopDefinition> = {
    name: 'merge',
    transition: { from: 'verified', to: 'merged' },
    gates: { requireDor: false, requireCi: true, tier: 'core' },
  };
  delete (detLoop as Record<string, unknown>)['expects'];

  it('advances exactly one step and is a no-op on re-run', async () => {
    const { gh, records, deps } = setup();
    const loop: LoopDefinition = { ...setup().loop, ...detLoop, expects: undefined };
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('verified')] });

    const first = await runLoopOnce(deps, loop, repo, CRON);
    expect(first[0]!.outcome).toMatchObject({ status: 'done', transition: 'verified->merged' });
    expect((await gh.getIssue(ref)).labels).toContain(stateLabel('merged'));

    const second = await runLoopOnce(deps, loop, repo, CRON);
    expect(second).toEqual([]);
    expect(records.records).toHaveLength(1);
  });
});

describe('transition runner (0012) — dry-run mode (0009)', () => {
  it('comments only: no labels, no claim, no dispatch; sticky comment updates in place', async () => {
    const { gh, backend, loop, deps } = setup({ mode: 'dry-run' });
    gh.seedIssue({ ref, body: GROOMED_BODY, labels: [stateLabel('ready-for-agent')] });

    await runLoopOnce(deps, loop, repo, CRON);
    await runLoopOnce(deps, loop, repo, CRON); // sweep again

    const issue = await gh.getIssue(ref);
    expect(issue.labels).toEqual([stateLabel('ready-for-agent')]); // untouched
    expect(backend.dispatched).toEqual([]);
    const dryRunComments = (await gh.listComments(ref)).filter((c) =>
      c.body.includes('looper:dry-run:implement'),
    );
    expect(dryRunComments).toHaveLength(1); // sticky, not spammed
    expect(dryRunComments[0]!.body).toContain('would claim, dispatch');
  });
});
