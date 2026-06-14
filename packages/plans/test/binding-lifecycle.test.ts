import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '@loopdog/testing';
import {
  RepoPlanStoreFiles,
  archivePlan,
  bindIssue,
  openPlan,
  parsePlanMarker,
  projectIndexes,
  parsePlan,
  rebuildIndexes,
  reconcileBinding,
  resolveBinding,
  updatePlan,
  verifyPlan,
} from '@loopdog/plans';
import { renderCriteriaBlock, stateLabel, statusForLabels } from '@loopdog/core';
import type { RunRecord } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 7 };
const NOW = new Date('2026-06-09T12:00:00Z');

const GROOMED_BODY = [
  'Please add rate limiting to the API.',
  '',
  renderCriteriaBlock([
    { text: 'limits at 100 req/min', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
  ]),
  '<!-- loopdog:scope -->api only<!-- /loopdog:scope -->',
].join('\n');

async function setup() {
  const gh = new FakeGitHub();
  await gh.ensureBranch(repo, 'main');
  const files = new RepoPlanStoreFiles(gh, repo, 'main', '.loopdog/plans');
  const issue = gh.seedIssue({
    ref,
    title: 'Add rate limiting',
    body: GROOMED_BODY,
    labels: [stateLabel('needs-grooming')],
  });
  return { gh, files, issue };
}

const record: RunRecord = {
  runId: 'run-implement-7-a1-abc',
  loop: 'implement',
  item: ref,
  trigger: { kind: 'cron', at: '2026-06-09T12:00:00Z' },
  backend: 'claude',
  steps: [],
  outcome: { status: 'pending' },
  cost: {},
};

describe('issue <-> plan binding (0016)', () => {
  it('binds once: task file + issue marker; re-bind is a no-op', async () => {
    const { gh, files, issue } = await setup();
    const binding = await bindIssue(gh, files, issue);
    expect(binding.taskId).toBe('0001');
    expect(binding.path).toBe('.loopdog/plans/tasks/0001-add-rate-limiting.md');

    const plan = (await files.read(binding.path))!.content;
    expect(plan).toContain('# 0001 Add rate limiting');
    expect(plan).toContain('Status: planned');
    expect(plan).toContain('Issue: #7');
    expect(plan).toContain('- [ ] limits at 100 req/min (test: rl.test.ts)');

    const body = (await gh.getIssue(ref)).body;
    expect(parsePlanMarker(body)).toEqual({ taskId: '0001', path: binding.path });

    // idempotent: same binding, no duplicate file/marker
    const again = await bindIssue(gh, files, await gh.getIssue(ref));
    expect(again).toEqual({ ...binding, issue: ref });
    expect((await files.list('.loopdog/plans/tasks')).length).toBe(1);
    expect(((await gh.getIssue(ref)).body.match(/loopdog:plan/g) ?? []).length).toBe(1);
  });

  it('resolves both directions and falls back to the Issue: field scan', async () => {
    const { gh, files, issue } = await setup();
    const binding = await bindIssue(gh, files, issue);
    // strip the marker (hand-edited issue) → fallback scan still resolves
    const stripped = (await gh.getIssue(ref)).body.replace(/<!-- loopdog:plan .* -->\n?/, '');
    await gh.updateIssueBody(ref, stripped);
    const resolved = await resolveBinding(files, await gh.getIssue(ref));
    expect(resolved?.taskId).toBe(binding.taskId);
  });

  it('reconciles drift with the label authoritative + logs the change; no-op when equal', async () => {
    const { gh, files, issue } = await setup();
    const binding = await bindIssue(gh, files, issue);

    // out-of-band label change: item now in-review
    await gh.addLabels(ref, [stateLabel('in-review')]);
    await gh.removeLabel(ref, stateLabel('needs-grooming'));
    const live = await gh.getIssue(ref);
    expect(statusForLabels(live.labels)).toBe('implemented');

    const first = await reconcileBinding(files, live, binding, NOW);
    expect(first).toEqual({ changed: true, status: 'implemented' });
    const plan = (await files.read(binding.path))!.content;
    expect(plan).toContain('Status: implemented');
    expect(plan).toContain('label is authoritative');

    const second = await reconcileBinding(files, live, binding, NOW);
    expect(second).toEqual({ changed: false });
  });
});

describe('plan-store fragmentation (0097)', () => {
  it('reuses the existing plan when a racing triage run lost the marker write', async () => {
    const { gh, files, issue } = await setup();
    // Run A binds: writes 0001 and appends the marker onto the live issue body.
    const a = await bindIssue(gh, files, issue);
    expect(a.taskId).toBe('0001');

    // Run B raced on a snapshot taken BEFORE the marker existed (no marker in
    // its body). It must reuse 0001 via the Issue-field scan, not mint 0002.
    const stale = { ...issue, body: GROOMED_BODY };
    const b = await bindIssue(gh, files, stale);
    expect(b.taskId).toBe('0001');
    expect(b.path).toBe(a.path);
    expect((await files.list('.loopdog/plans/tasks')).length).toBe(1);
    expect(parsePlanMarker((await gh.getIssue(ref)).body)?.taskId).toBe('0001');
  });

  it('openPlan carries the groomed scope block into the plan Scope section', async () => {
    const { gh, files, issue } = await setup();
    const binding = await openPlan(gh, files, issue);
    const plan = (await files.read(binding.path))!.content;
    expect(plan).toMatch(/## Scope\n+api only/);
    expect(plan).not.toContain('(groomed scope lands here)');
  });

  it('matches the Issue: field on #N exactly, so #2 never resolves to #20', async () => {
    const { gh, files } = await setup();
    const twenty = gh.seedIssue({ ref: { ...repo, number: 20 }, title: 'Twenty', body: 'x' });
    await bindIssue(gh, files, twenty); // 0001 bound to #20

    const two = gh.seedIssue({ ref: { ...repo, number: 2 }, title: 'Two', body: 'no marker' });
    expect(await resolveBinding(files, two)).toBeNull(); // #2 must NOT find #20's plan

    const bound = await bindIssue(gh, files, two);
    expect(bound.taskId).toBe('0002'); // its own plan, not a reuse of 0001
    expect((await files.read(bound.path))!.content).toContain('Issue: #2');
  });
});

describe('plan lifecycle (0017)', () => {
  it('open -> update -> verify -> archive, each idempotent under double-apply', async () => {
    const { gh, files, issue } = await setup();

    // open (DoR passed): Status ready + criteria carried
    const binding = await openPlan(gh, files, issue);
    let plan = (await files.read(binding.path))!.content;
    expect(plan).toContain('Status: ready');
    await openPlan(gh, files, await gh.getIssue(ref)); // double-apply
    expect((await files.read(binding.path))!.content).toBe(plan);

    // update: run_id-keyed append + checklist tick
    const u1 = await updatePlan(files, binding, record, {
      checklist: ['(filled in by the implementation work cell)'],
      note: 'implement: dispatched',
    });
    expect(u1.changed).toBe(true);
    const u2 = await updatePlan(files, binding, record, { note: 'implement: dispatched' });
    expect(u2.changed).toBe(false); // same run_id appends nothing
    plan = (await files.read(binding.path))!.content;
    expect(plan).toContain('run `run-implement-7-a1-abc`');
    expect(plan).toContain('- [x] (filled in by the implementation work cell)');

    // verify: status + all criteria checked + summary
    const v1 = await verifyPlan(files, binding, 'Implemented rate limiting; DoD green.');
    expect(v1.changed).toBe(true);
    expect((await verifyPlan(files, binding, 'x')).changed).toBe(false);
    plan = (await files.read(binding.path))!.content;
    expect(plan).toContain('Status: verified');
    expect(plan).not.toContain('- [ ] limits');
    expect(plan).toContain('Implemented rate limiting; DoD green.');

    // archive: moved + tombstone + idempotent
    const a1 = await archivePlan(files, binding, 'merged');
    expect(a1.changed).toBe(true);
    const archived = (await files.read(a1.archivedPath!))!.content;
    expect(archived).toContain('Status: merged');
    const tombstone = (await files.read(binding.path))!.content;
    expect(tombstone).toContain('archived');
    const a2 = await archivePlan(files, { ...binding, path: a1.archivedPath! }, 'merged');
    expect(a2.changed).toBe(false);
  });
});

describe('index maintenance (0018)', () => {
  it('projects deterministic indexes; rebuild is idempotent and heals hand-edits', async () => {
    const { gh, files, issue } = await setup();
    await bindIssue(gh, files, issue);
    const second = gh.seedIssue({
      ref: { ...repo, number: 8 },
      title: 'Fix login bug',
      body: GROOMED_BODY,
    });
    await bindIssue(gh, files, second);

    const first = await rebuildIndexes(files);
    expect(first.wrote).toContain('.loopdog/plans/plan-index.md');
    const index = (await files.read('.loopdog/plans/plan-index.md'))!.content;
    expect(index).toContain('| 0001 | planned |');
    expect(index).toContain('| 0002 | planned |');
    expect(index).toContain('**Next task id:** `0003`');

    // identical input → no writes
    const again = await rebuildIndexes(files);
    expect(again.wrote).toEqual([]);

    // hand-edit → rebuild is authoritative
    await files.write('.loopdog/plans/plan-index.md', 'vandalized', 'hand edit');
    const healed = await rebuildIndexes(files);
    expect(healed.wrote).toContain('.loopdog/plans/plan-index.md');
    expect((await files.read('.loopdog/plans/plan-index.md'))!.content).toContain('| 0002 |');
  });

  it('skips malformed plans with a report and projects the rest', async () => {
    const { gh, files, issue } = await setup();
    await bindIssue(gh, files, issue);
    await files.write('.loopdog/plans/tasks/garbage.md', 'not a plan at all', 'bad file');
    const result = await rebuildIndexes(files);
    expect(result.skipped).toContain('.loopdog/plans/tasks/garbage.md');
    expect((await files.read('.loopdog/plans/plan-index.md'))!.content).toContain('| 0001 |');
  });

  it('archived plans leave the active index and ids are never reused', async () => {
    const { gh, files, issue } = await setup();
    const binding = await bindIssue(gh, files, issue);
    await archivePlan(files, binding, 'merged');
    await rebuildIndexes(files);
    const active = (await files.read('.loopdog/plans/plan-index.md'))!.content;
    expect(active).not.toContain('| 0001 | merged |');
    const archiveIndex = (await files.read('.loopdog/plans/archive/plan-index.md'))!.content;
    expect(archiveIndex).toContain('| 0001 | merged |');
    expect(active).toContain('**Next task id:** `0002`'); // id retired, not reused
    expect(await files.nextTaskId()).toBe('0002');
  });

  it('projectIndexes is pure and stable', () => {
    const doc = parsePlan('# 0009 Some Task\n\nStatus: ready\nBranch: b\n\n## Goal\n\nx\n');
    const a = projectIndexes([doc], []);
    const b = projectIndexes([doc], []);
    expect(a).toEqual(b);
    expect(a.planIndex).toContain('| 0009 | ready | b | Some Task |');
  });
});
