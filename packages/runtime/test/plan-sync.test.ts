import { describe, expect, it } from 'vitest';
import { EffectGate, runLoopOnce, syncPlanAfterTransition } from '@loopdog/runtime';
import type { RunnerDeps } from '@loopdog/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@loopdog/testing';
import { RepoPlanStoreFiles } from '@loopdog/plans';
import { DEFAULT_TRANSITION_TABLE, renderCriteriaBlock, stateLabel } from '@loopdog/core';
import type { ItemRef, LoopDefinition, RunRecord, TriggerEvent } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };
const CRON: TriggerEvent = { kind: 'cron', deliveredAt: '2026-06-09T12:00:00Z' };

const GROOMED_BODY = [
  'Add rate limiting.',
  renderCriteriaBlock([
    { text: 'limits requests', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
  ]),
  '<!-- loopdog:scope -->api only<!-- /loopdog:scope -->',
].join('\n\n');

async function setup() {
  const gh = new FakeGitHub();
  await gh.ensureBranch(repo, 'main');
  const backend = new FakeBackend(gh, { id: 'claude' });
  const planFiles = new RepoPlanStoreFiles(gh, repo, 'main', '.loopdog/plans');
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
  promptPath: '.loopdog/loops/implement/prompt.md',
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
    const path = '.loopdog/plans/tasks/0001-add-rate-limiting.md';
    let plan = (await planFiles.read(path))!.content;
    expect(plan).toContain('# 0001 Add rate limiting');
    expect(plan).toContain('Status: in-progress'); // mirrored from the label
    expect(plan).toContain('implement: in-progress');

    // ingest: PR arrives → in-review → plan mirrors implemented
    await runLoopOnce(deps, implementLoop, repo, CRON);
    plan = (await planFiles.read(path))!.content;
    expect(plan).toContain('Status: implemented');

    // the issue carries the plan marker (two-way link)
    expect((await gh.getIssue(ref)).body).toContain('<!-- loopdog:plan task=0001');
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
    expect(await planFiles.list('.loopdog/plans/tasks')).toEqual([]);
    expect(out[0]!.planned!.some((a) => a.kind === 'plan')).toBe(true); // intended, recorded
  });
});

function recordFor(loop: string, item: ItemRef): RunRecord {
  return {
    runId: `run-${loop}-${item.number}-a1`,
    loop,
    item,
    trigger: { kind: 'cron', at: '2026-06-09T13:00:00Z' },
    backend: 'claude',
    steps: [],
    outcome: { status: 'done' },
    cost: {},
  };
}

describe('the plan binds to the source issue, never the PR (0098)', () => {
  it('a PR transition updates the issue plan; Issue: stays the source, no PR-numbered plan', async () => {
    const { gh, planFiles, deps } = await setup();
    gh.seedIssue({
      ref,
      title: 'Add rate limiting',
      body: GROOMED_BODY,
      labels: [stateLabel('ready-for-agent')],
    });
    // implement dispatch mints the issue's plan (0001, Issue: #1)
    await runLoopOnce(deps, implementLoop, repo, CRON);
    const planPath = '.loopdog/plans/tasks/0001-add-rate-limiting.md';
    expect((await planFiles.read(planPath))!.content).toContain('Issue: #1');

    // a review loop runs on PR #2, whose body links the source issue #1
    const prRef = { ...repo, number: 2 };
    gh.seedPull({
      ref: prRef,
      headRef: 'feat/rl',
      body: 'Implements #1',
      labels: [stateLabel('verified')],
    });
    await syncPlanAfterTransition(
      gh,
      planFiles,
      new EffectGate('act'),
      await gh.getPullRequest(prRef),
      'verified',
      recordFor('review', prRef),
      new Date('2026-06-09T13:00:00Z'),
    );

    // still exactly one plan, still bound to the issue, now verified
    expect(await planFiles.list('.loopdog/plans/tasks')).toEqual(['0001-add-rate-limiting.md']);
    const plan = (await planFiles.read(planPath))!.content;
    expect(plan).toContain('Issue: #1');
    expect(plan).not.toContain('Issue: #2');
    expect(plan).toContain('Status: verified');
  });

  it('skips plan upkeep for a PR with no linked source issue (mints nothing)', async () => {
    const { gh, planFiles } = await setup();
    const prRef = { ...repo, number: 5 };
    gh.seedPull({
      ref: prRef,
      headRef: 'feat/x',
      body: 'standalone PR, no issue reference',
      labels: [stateLabel('in-review')],
    });
    await syncPlanAfterTransition(
      gh,
      planFiles,
      new EffectGate('act'),
      await gh.getPullRequest(prRef),
      'in-progress',
      recordFor('review', prRef),
      new Date('2026-06-09T13:00:00Z'),
    );
    expect(await planFiles.list('.loopdog/plans/tasks')).toEqual([]);
  });
});
