import { describe, expect, it } from 'vitest';
import {
  aggregateOutcomes,
  createPreflight,
  renderRunReport,
  reviewerFor,
  routeBackend,
  runLoopOnce,
} from '@loopdog/runtime';
import type { PreflightConfig, RunnerDeps } from '@loopdog/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@loopdog/testing';
import {
  DEFAULT_TRANSITION_TABLE,
  backoffUntil,
  budgetGate,
  killSwitchGate,
  ledgerStats,
  quotaGate,
  renderCriteriaBlock,
  stateLabel,
} from '@loopdog/core';
import type { LoopDefinition, RunRecord, TriggerEvent } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };
const NOW = new Date('2026-06-09T12:00:00Z');
const CRON: TriggerEvent = { kind: 'cron', deliveredAt: NOW.toISOString() };

const GROOMED = [
  'Body.',
  renderCriteriaBlock([
    { text: 'works', validation: { kind: 'test', ref: 'a.test.ts' }, met: false },
  ]),
  '<!-- loopdog:scope -->bounded<!-- /loopdog:scope -->',
].join('\n');

function fakeRecord(partial: Partial<RunRecord>): RunRecord {
  return {
    runId: 'run-x',
    loop: 'implement',
    item: ref,
    trigger: { kind: 'cron', at: NOW.toISOString() },
    backend: 'claude',
    steps: [{ t: NOW.toISOString(), kind: 'dispatch', detail: 'ok' }],
    outcome: { status: 'done' },
    cost: {},
    ...partial,
  };
}

const PREFLIGHT_CONFIG: PreflightConfig = {
  budgets: {
    window: 'daily',
    global: { max_dispatches: 0, max_usd: 0 },
    per_loop: { max_dispatches: 0, max_usd: 0 },
    on_exceeded: 'park',
  },
  kill_switch: { variable: 'LOOPDOG_KILL', label: 'loopdog:stop' },
  quota: { window: 'daily', on_exceeded: 'defer' },
};

function implementLoop(patch: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    name: 'implement',
    trigger: { kind: 'github_event', events: ['issues.labeled'] },
    transition: { from: 'ready-for-agent', to: 'in-review' },
    backend: 'claude',
    gates: { requireDor: true, requireCi: true, tier: 'default' },
    promptPath: 'x',
    mode: 'act',
    expects: 'pull-request',
    ...patch,
  };
}

describe('guards (0050/0075/0051) — pure', () => {
  it('kill switch denies on variable or label', () => {
    expect(killSwitchGate({ variableSet: false, labelPresent: false })).toEqual({ allowed: true });
    expect(killSwitchGate({ variableSet: true, labelPresent: false }).allowed).toBe(false);
    expect(killSwitchGate({ variableSet: false, labelPresent: true }).allowed).toBe(false);
  });

  it('budget denies when one more dispatch crosses a ceiling; 0 = unlimited', () => {
    const records = [fakeRecord({}), fakeRecord({ loop: 'review' })];
    const stats = ledgerStats(records, 'implement', new Date(NOW.getTime() - 86_400_000));
    expect(stats).toMatchObject({ globalDispatches: 2, loopDispatches: 1 });

    const unlimited = budgetGate(stats, {
      windowMs: 1,
      global: { maxDispatches: 0, maxUsd: 0 },
      perLoop: { maxDispatches: 0, maxUsd: 0 },
    });
    expect(unlimited.allowed).toBe(true);

    const capped = budgetGate(stats, {
      windowMs: 1,
      global: { maxDispatches: 2, maxUsd: 0 },
      perLoop: { maxDispatches: 0, maxUsd: 0 },
    });
    expect(capped.allowed).toBe(false);
    if (!capped.allowed) expect(capped.guard).toBe('budget');
  });

  it('quota parks with the next window slot (rolling vs calendar)', () => {
    const rolling = quotaGate(
      5,
      'codex',
      { windowMs: 3_600_000, maxDispatches: 5, kind: 'rolling' },
      NOW,
    );
    expect(rolling.allowed).toBe(false);
    if (!rolling.allowed) {
      expect(rolling.guard).toBe('quota');
      expect(rolling.retryAfter).toBe('2026-06-09T13:00:00.000Z');
    }
    const calendar = quotaGate(
      50,
      'claude',
      { windowMs: 0, maxDispatches: 50, kind: 'calendar' },
      NOW,
    );
    if (!calendar.allowed) expect(calendar.retryAfter).toBe('2026-06-10T00:00:00.000Z');
    expect(quotaGate(99, 'self-hosted', undefined, NOW).allowed).toBe(true); // uncapped
  });

  it('backoff doubles per attempt and caps', () => {
    expect(backoffUntil(1, NOW)).toBe('2026-06-09T12:00:30.000Z');
    expect(backoffUntil(2, NOW)).toBe('2026-06-09T12:01:00.000Z');
    expect(backoffUntil(10, NOW)).toBe('2026-06-09T12:10:00.000Z'); // capped at 10m
  });
});

describe('pre-flight wiring (M12) — behavioral', () => {
  it('kill switch parks the item with a hold comment; no dispatch, no spend', async () => {
    const gh = new FakeGitHub();
    const backend = new FakeBackend(gh, { id: 'claude' });
    const records = new InMemoryRunRecordStore();
    gh.seedIssue({ ref, body: GROOMED, labels: [stateLabel('ready-for-agent')] });
    const deps: RunnerDeps = {
      gh,
      backends: new Map([['claude', backend]]),
      records,
      table: DEFAULT_TRANSITION_TABLE,
      readPrompt: async () => 'p',
      extraChecks: createPreflight({
        gh,
        records,
        backends: new Map([['claude', backend]]),
        repo,
        config: PREFLIGHT_CONFIG,
        env: { LOOPDOG_KILL: '1' } as NodeJS.ProcessEnv,
        now: () => NOW,
      }),
    };
    const out = await runLoopOnce(deps, implementLoop(), repo, CRON);
    expect(out[0]!.outcome.status).toBe('parked');
    expect(backend.dispatched).toEqual([]);
    expect((await gh.getIssue(ref)).labels).toContain('loopdog:parked');
  });

  it('quota exhaustion defers with retryAfter; the sweep unparks after it passes', async () => {
    const gh = new FakeGitHub();
    const backend = new FakeBackend(gh, { id: 'codex' });
    const records = new InMemoryRunRecordStore();
    // 5 codex dispatches already in the last hour
    for (let i = 0; i < 5; i++) {
      await records.append(fakeRecord({ runId: `run-${i}`, backend: 'codex' }));
    }
    gh.seedIssue({ ref, body: GROOMED, labels: [stateLabel('ready-for-agent')] });
    const deps: RunnerDeps = {
      gh,
      backends: new Map([['codex', backend]]),
      records,
      table: DEFAULT_TRANSITION_TABLE,
      readPrompt: async () => 'p',
      now: () => NOW,
      extraChecks: createPreflight({
        gh,
        records,
        backends: new Map([['codex', backend]]),
        repo,
        config: {
          ...PREFLIGHT_CONFIG,
          quota: {
            ...PREFLIGHT_CONFIG.quota,
            backends: { codex: { window: '1h', max_dispatches: 5 } },
          },
        },
        env: {} as NodeJS.ProcessEnv,
        now: () => NOW,
      }),
    };
    const loop = implementLoop({ backend: 'codex' });
    const out = await runLoopOnce(deps, loop, repo, CRON);
    expect(out[0]!.outcome.status).toBe('parked');
    expect(backend.dispatched).toEqual([]);
    const holdComment = (await gh.listComments(ref)).find((c) => c.body.includes('loopdog:hold'));
    expect(holdComment!.body).toContain('2026-06-09T13:00:00.000Z');
  });
});

describe('telemetry aggregation + reporting (0052/0053)', () => {
  it('aggregates per (loop, backend) with a sample floor', () => {
    const records = [
      fakeRecord({ outcome: { status: 'done' } }),
      fakeRecord({ outcome: { status: 'done' } }),
      fakeRecord({ outcome: { status: 'failed' } }),
      fakeRecord({ backend: 'codex', outcome: { status: 'done' } }),
    ];
    const aggregates = aggregateOutcomes(records, 2);
    const claude = aggregates.find((a) => a.backend === 'claude')!;
    expect(claude).toMatchObject({ dispatches: 3, done: 2, failed: 1 });
    expect(claude.successRate).toBeCloseTo(2 / 3);
    const codex = aggregates.find((a) => a.backend === 'codex')!;
    expect(codex.successRate).toBeNull(); // below the floor
  });

  it('renders compact run-report lines', () => {
    const lines = renderRunReport([
      fakeRecord({ outcome: { status: 'done', transition: 'a->b' }, cost: { routineRuns: 1 } }),
    ]);
    expect(lines[0]).toBe('implement #1 [claude] done (a->b) routineRuns=1');
  });
});

describe('multi-model policies (0054/0056/0057)', () => {
  it('reviewerFor: per-tier pairing, never the implementer', () => {
    const policy = { never_same_as_implementer: true, by_tier: { core: 'claude' } };
    expect(reviewerFor('claude', 'core', policy)).toBe('codex'); // flipped: same as implementer
    expect(reviewerFor('codex', 'core', policy)).toBe('claude');
    expect(reviewerFor('claude', 'default', policy, 'codex')).toBe('codex'); // root default
    expect(reviewerFor('claude', 'safe', { never_same_as_implementer: true, by_tier: {} })).toBe(
      'codex',
    ); // derived opposite
  });

  it('routeBackend: outcome-driven with floor, preference fallback, and pins', () => {
    const aggregates = aggregateOutcomes(
      [
        ...Array.from({ length: 6 }, () => fakeRecord({ outcome: { status: 'done' } })),
        ...Array.from({ length: 6 }, () =>
          fakeRecord({ backend: 'codex', outcome: { status: 'failed' } }),
        ),
      ],
      5,
    );
    const config = { mode: 'outcome' as const, prefer: 'balanced' as const, min_samples: 5 };
    const routed = routeBackend('implement', ['claude', 'codex'], aggregates, config, 'codex');
    expect(routed.backend).toBe('claude');
    expect(routed.reason).toContain('100% success');

    // no signal → preference knob
    const cold = routeBackend(
      'groom',
      ['claude', 'codex'],
      [],
      { ...config, prefer: 'cost' },
      'claude',
    );
    expect(cold.backend).toBe('codex');

    // pins always win
    const pinned = routeBackend(
      'implement',
      ['claude', 'codex'],
      aggregates,
      { ...config, pin: { implement: 'codex' } },
      'claude',
    );
    expect(pinned.backend).toBe('codex');

    // static mode ignores the ledger
    expect(
      routeBackend(
        'implement',
        ['claude', 'codex'],
        aggregates,
        { ...config, mode: 'static' },
        'codex',
      ).backend,
    ).toBe('codex');
  });
});

describe('ensemble & judge (0055)', () => {
  it('tier:core dual-attempt: two PRs, a judge verdict, winner advances, loser retired', async () => {
    const gh = new FakeGitHub();
    const claude = new FakeBackend(gh, { id: 'claude' });
    const codex = new FakeBackend(gh, { id: 'codex' });
    const records = new InMemoryRunRecordStore();
    gh.seedIssue({ ref, body: GROOMED, labels: [stateLabel('ready-for-agent')] });

    const deps: RunnerDeps = {
      gh,
      backends: new Map([
        ['claude', claude],
        ['codex', codex],
      ]),
      records,
      table: DEFAULT_TRANSITION_TABLE,
      readPrompt: async () => 'implement prompt',
      botLogin: 'github-actions[bot]',
    };
    const loop = implementLoop({
      gates: { requireDor: true, requireCi: true, tier: 'core' },
      ensemble: { enabled: true, judge: 'codex' },
    });

    // tick 1: fan-out — two dispatches, two markers
    const first = await runLoopOnce(deps, loop, repo, CRON);
    expect(first[0]!.outcome.status).toBe('pending');
    expect(claude.dispatched).toHaveLength(1);
    expect(codex.dispatched).toHaveLength(1);

    // tick 2: both attempts complete (PRs open) → judge dispatched
    await runLoopOnce(deps, loop, repo, CRON);
    const judgeMention = codex.dispatched.find((b) => b.runId.endsWith('-judge'));
    expect(judgeMention).toBeDefined();
    expect(judgeMention!.instructions).toContain('Pick exactly ONE winner');

    // tick 3: the judge verdict picks the claude attempt's PR
    const prs = await gh.listPullRequestsByHeadPrefix(repo, 'loopdog/implement/');
    expect(prs).toHaveLength(2);
    const winner = prs[0]!;
    codex.resultVerdict = `loopdog-winner: #${winner.ref.number}`;
    const final = await runLoopOnce(deps, loop, repo, CRON);
    expect(final[0]!.outcome).toMatchObject({
      status: 'done',
      transition: 'ready-for-agent->in-review',
      artifacts: { pr: winner.ref.number },
    });
    expect((await gh.getIssue(ref)).labels).toContain(stateLabel('in-review'));
    expect((await gh.getPullRequest(winner.ref)).labels).toContain(stateLabel('in-review'));
    const loser = prs[1]!;
    expect((await gh.getPullRequest(loser.ref)).labels).toContain('loopdog:abandoned');
    expect(
      (await gh.listComments(loser.ref)).some((c) => c.body.includes('ensemble judge selected')),
    ).toBe(true);
  });
});
