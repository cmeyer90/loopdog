import { describe, expect, it } from 'vitest';
import { runSweep } from '@loopdog/runtime';
import type { RunnerDeps, SweepOptions } from '@loopdog/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@loopdog/testing';
import { DEFAULT_TRANSITION_TABLE, claimLabel, leaseLabel, stateLabel } from '@loopdog/core';
import type { LoopDefinition } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };
const NOW = new Date('2026-06-09T12:00:00Z');
const OPTS: SweepOptions = {
  intervalMinutes: 5,
  maxCandidatesPerTick: 20,
  maxCandidatesPerState: 10,
};

const GROOMED = [
  'Body.',
  '<!-- loopdog:acceptance-criteria -->',
  '- [ ] works (test: a.test.ts)',
  '<!-- /loopdog:acceptance-criteria -->',
  '<!-- loopdog:scope -->bounded<!-- /loopdog:scope -->',
].join('\n');

function mergeLoop(): LoopDefinition {
  return {
    name: 'merge',
    trigger: { kind: 'github_event', events: ['pull_request_review.submitted'] },
    transition: { from: 'verified', to: 'merged' },
    backend: 'claude',
    gates: { requireDor: false, requireCi: true, tier: 'core' },
    promptPath: '.loopdog/loops/merge/prompt.md',
    mode: 'act',
  };
}

function setup() {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const records = new InMemoryRunRecordStore();
  const deps: RunnerDeps = {
    gh,
    backends: new Map([['claude', backend]]),
    records,
    table: DEFAULT_TRANSITION_TABLE,
    readPrompt: async () => 'prompt',
    botLogin: 'github-actions[bot]',
    now: () => NOW,
  };
  return { gh, backend, records, deps };
}

describe('cron reconcile sweep (0076)', () => {
  it('recovers a stranded item (the missed-webhook backstop) and is idempotent', async () => {
    const { gh, deps } = setup();
    // Item sits in verified — its event was "dropped"; nobody advanced it.
    gh.seedIssue({ ref: { ...repo, number: 1 }, body: GROOMED, labels: [stateLabel('verified')] });

    const first = await runSweep(deps, [mergeLoop()], repo, OPTS);
    expect(first.processed).toEqual([{ loop: 'merge', item: 1, status: 'done' }]);
    expect((await gh.getIssue({ ...repo, number: 1 })).labels).toContain(stateLabel('merged'));

    const second = await runSweep(deps, [mergeLoop()], repo, OPTS);
    expect(second.processed).toEqual([]); // nothing left — cheap no-op tick
    expect(second.candidates).toBe(0);
  });

  it('reclaims expired leases, then advances the item in the same tick', async () => {
    const { gh, deps } = setup();
    gh.seedIssue({
      ref: { ...repo, number: 2 },
      body: GROOMED,
      labels: [
        stateLabel('verified'),
        claimLabel('run-dead~x1'),
        leaseLabel('2026-06-09T11:00:00.000Z'), // expired an hour ago
      ],
    });
    const summary = await runSweep(deps, [mergeLoop()], repo, OPTS);
    expect(summary.reclaimedLeases).toBe(1);
    expect(summary.processed).toHaveLength(1);
    expect((await gh.getIssue({ ...repo, number: 2 })).labels).toContain(stateLabel('merged'));
  });

  it('skips off-ramps, holds, quarantine, parked, and malformed items with reasons', async () => {
    const { gh, deps } = setup();
    const cases: Array<[number, string[]]> = [
      [1, [stateLabel('verified'), 'loopdog:needs-human']],
      [2, [stateLabel('verified'), 'loopdog:quarantine']],
      [3, [stateLabel('verified'), 'loopdog:stop']],
      [4, [stateLabel('verified'), 'loopdog:needs-approval']],
      [5, [stateLabel('verified'), 'loopdog:parked']],
      [6, [stateLabel('verified'), stateLabel('merged')]], // malformed: two states
    ];
    for (const [n, labels] of cases) {
      gh.seedIssue({ ref: { ...repo, number: n }, body: GROOMED, labels });
    }
    const summary = await runSweep(deps, [mergeLoop()], repo, OPTS);
    expect(summary.processed).toEqual([]);
    expect(summary.skipped.map((s) => s.item).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(summary.skipped.find((s) => s.item === 6)!.reason).toContain('multiple lifecycle');
    // an approved hold is NOT skipped
    gh.seedIssue({
      ref: { ...repo, number: 7 },
      body: GROOMED,
      labels: [stateLabel('verified'), 'loopdog:needs-approval', 'loopdog:approved'],
    });
    const second = await runSweep(deps, [mergeLoop()], repo, OPTS);
    expect(second.processed.map((p) => p.item)).toEqual([7]);
  });

  it('evaluates cron loops only when due; missed ticks coalesce into the window', async () => {
    const { gh, deps } = setup();
    gh.seedIssue({ ref: { ...repo, number: 1 }, body: GROOMED, labels: [stateLabel('verified')] });
    const cronLoop: LoopDefinition = {
      ...mergeLoop(),
      name: 'nightly-merge',
      trigger: { kind: 'cron', schedule: 'daily' },
    };

    // 12:00 — daily (00:00) not due in a 5-minute window
    const notDue = await runSweep(deps, [cronLoop], repo, OPTS);
    expect(notDue.candidates).toBe(0);

    // 00:02 — due
    const midnight = { ...deps, now: () => new Date('2026-06-09T00:02:00Z') };
    const due = await runSweep(midnight, [cronLoop], repo, OPTS);
    expect(due.processed).toHaveLength(1);
  });

  it('caps candidates per tick and reports the deferral instead of truncating silently', async () => {
    const { gh, deps } = setup();
    for (let n = 1; n <= 5; n++) {
      gh.seedIssue({
        ref: { ...repo, number: n },
        body: GROOMED,
        labels: [stateLabel('verified')],
      });
    }
    const summary = await runSweep(deps, [mergeLoop()], repo, {
      ...OPTS,
      maxCandidatesPerTick: 2,
    });
    expect(summary.processed).toHaveLength(2);
    expect(summary.deferredByCap).toBe(3);
    // the deferred items are picked up next tick
    const next = await runSweep(deps, [mergeLoop()], repo, { ...OPTS, maxCandidatesPerTick: 2 });
    expect(next.processed).toHaveLength(2);
  });

  it('one transition per item per tick even when several loops match', async () => {
    const { gh, deps, records } = setup();
    gh.seedIssue({ ref: { ...repo, number: 1 }, body: GROOMED, labels: [stateLabel('verified')] });
    const competing: LoopDefinition = { ...mergeLoop(), name: 'alt-merge' };
    const summary = await runSweep(deps, [mergeLoop(), competing], repo, OPTS);
    expect(summary.processed).toHaveLength(1);
    expect(records.records).toHaveLength(1);
  });
});
