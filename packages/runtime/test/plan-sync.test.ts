import { describe, expect, it } from 'vitest';
import { runLoopOnce } from '@looper/runtime';
import type { RunnerDeps } from '@looper/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@looper/testing';
import { RepoPlanStoreFiles } from '@looper/plans';
import { DEFAULT_TRANSITION_TABLE, renderCriteriaBlock, stateLabel } from '@looper/core';
import type { LoopDefinition, TriggerEvent } from '@looper/core';

const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };
const CRON: TriggerEvent = { kind: 'cron', deliveredAt: '2026-06-09T12:00:00Z' };

const GROOMED_BODY = [
  'Add rate limiting.',
  renderCriteriaBlock([
    { text: 'limits requests', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
  ]),
  '<!-- looper:scope -->api only<!-- /looper:scope -->',
].join('\n\n');

async function setup() {
  const gh = new FakeGitHub();
  await gh.ensureBranch(repo, 'main');
  const backend = new FakeBackend(gh, { id: 'claude' });
  const planFiles = new RepoPlanStoreFiles(gh, repo, 'main', '.looper/plans');
  const deps: RunnerDeps = {
    gh,
    backends: new Map([['claude', backend]]),
    records: new InMemoryRunRecordStore(),
    table: DEFAULT_TRANSITION_TABLE,
    readPrompt: async () => 'implement work cell prompt',
    botLogin: 'github-actions[bot]',
    planFiles,
  };
  return { gh, backend, planFiles, deps };
}

const implementLoop: LoopDefinition = {
  name: 'implement',
  trigger: { kind: 'github_event', events: ['issues.labeled'] },
  transition: { from: 'ready-for-agent', to: 'in-review' },
  backend: 'claude',
  gates: { requireDor: true, requireCi: true, tier: 'default' },
  promptPath: '.looper/loops/implement/prompt.md',
  mode: 'act',
  expects: 'pull-request',
};

describe('plan lifecycle wiring in the runner (0017)', () => {
  it('keeps the durable plan in lockstep across dispatch and ingest', async () => {
    const { gh, planFiles, deps } = await setup();
    gh.seedIssue({
      ref,
      title: 'Add rate limiting',
      body: GROOMED_BODY,
      labels: [stateLabel('ready-for-agent')],
    });

    // dispatch: a plan is bound + updated, status mirrors in-progress
    await runLoopOnce(deps, implementLoop, repo, CRON);
    const path = '.looper/plans/tasks/0001-add-rate-limiting.md';
    let plan = (await planFiles.read(path))!.content;
    expect(plan).toContain('# 0001 Add rate limiting');
    expect(plan).toContain('Status: in-progress'); // mirrored from the label
    expect(plan).toContain('implement: in-progress');

    // ingest: PR arrives → in-review → plan mirrors implemented
    await runLoopOnce(deps, implementLoop, repo, CRON);
    plan = (await planFiles.read(path))!.content;
    expect(plan).toContain('Status: implemented');

    // the issue carries the plan marker (two-way link)
    expect((await gh.getIssue(ref)).body).toContain('<!-- looper:plan task=0001');
  });

  it('makes no plan writes in dry-run (plan upkeep is gated too)', async () => {
    const { gh, planFiles, deps } = await setup();
    gh.seedIssue({
      ref,
      title: 'Add rate limiting',
      body: GROOMED_BODY,
      labels: [stateLabel('ready-for-agent')],
    });
    const out = await runLoopOnce({ ...deps, forceDryRun: true }, implementLoop, repo, CRON);
    expect(await planFiles.list('.looper/plans/tasks')).toEqual([]);
    expect(out[0]!.planned!.some((a) => a.kind === 'plan')).toBe(true); // intended, recorded
  });
});
