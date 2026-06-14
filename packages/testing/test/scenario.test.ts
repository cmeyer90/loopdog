import { afterAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { stateLabel } from '@loopdog/core';
import {
  FakeGitHub,
  InMemoryRunRecordStore,
  ReplayBackend,
  VirtualClock,
  assertGolden,
  checkInvariants,
  goldenJson,
  runScenario,
  type Cassette,
  type Scenario,
  type ScenarioWorld,
} from '@loopdog/testing';
import type { ControllerOptions } from '@loopdog/runtime';
import { cleanup, GROOMED_BODY, makeWorld, repo, scaffoldActRepo } from './helpers.js';

/**
 * Scenario runner + golden assertions (task 0085): the declarative runner drives
 * the unmodified controller over the fakes and snapshots end-state to a golden.
 * Proves determinism, idempotent re-delivery, the no-retrigger sweep semantics,
 * a gate block, and fake-vs-replay golden equality — all offline, zero quota.
 */

const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/goldens/', import.meta.url));

afterAll(cleanup);

/** A ready issue that the implement loop will pick up and dispatch. */
function readyIssue(number = 1) {
  return {
    ref: { number },
    title: 'Add rate limiting',
    body: GROOMED_BODY,
    labels: [stateLabel('ready-for-agent')],
    author: { login: 'dana' as const, type: 'User' as const },
  };
}

const IMPLEMENT_HAPPY: Scenario = {
  name: 'implement-happy-path',
  initial: { issues: [readyIssue()] },
  steps: [
    { sweep: {} }, // dispatch implement → in-progress (pending)
    { sweep: {} }, // ingest the agent's PR → in-review
  ],
};

describe('scenario runner + goldens (0085)', () => {
  it('drives the implement loop to a deterministic golden (two runs byte-identical)', async () => {
    const repoDir = await scaffoldActRepo();
    const a = await runScenario(makeWorld(repoDir), IMPLEMENT_HAPPY);
    const b = await runScenario(makeWorld(repoDir), IMPLEMENT_HAPPY);
    // Determinism: same scenario + seed → byte-identical golden.
    expect(goldenJson(a.golden)).toEqual(goldenJson(b.golden));
    // The item reached in-review and a PR was opened and correlated.
    expect(a.golden.labels['1']).toContain(stateLabel('in-review'));
    expect(a.golden.prs).toHaveLength(1);
    expect(a.golden.prs[0]!.linksIssue).toBe(1);
    // Compare (or create under LOOPDOG_UPDATE_GOLDENS=1) the committed golden.
    await assertGolden(a, 'implement-happy-path', { dir: GOLDEN_DIR });
  });

  it('idempotent re-delivery: a re-delivered trigger never double-dispatches', async () => {
    const repoDir = await scaffoldActRepo();
    const labeled = {
      event: {
        name: 'issues',
        payload: {
          action: 'labeled',
          issue: { number: 1, author_association: 'OWNER' },
          label: { name: stateLabel('ready-for-agent') },
          sender: { login: 'dana', type: 'User' },
        },
      },
    };
    // At-least-once delivery: the SAME labeled event arrives three times. The
    // first dispatches; the re-deliveries are absorbed (a pending dispatch
    // takes precedence over re-dispatching — transition-runner.ts:192). The
    // result is exactly one implement dispatch and one correlated PR.
    const world = makeWorld(repoDir);
    const result = await runScenario(world, {
      name: 'idem-redelivery',
      initial: { issues: [readyIssue()] },
      steps: [labeled, labeled, labeled],
    });
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(1);
    const prs = await world.gh.listPullRequestsByHeadPrefix(repo, 'loopdog/implement/', {
      state: 'all',
    });
    expect(prs).toHaveLength(1); // one correlated PR, not one per delivery
    // The invariants confirm: no double-dispatch, idempotent ingest.
    expect(checkInvariants({ gh: world.gh, records: result.runs })).toEqual([]);
  });

  it('token→token handoff: a controller-written transition only advances on the next sweep', async () => {
    const repoDir = await scaffoldActRepo();
    const world = makeWorld(repoDir);
    // One sweep dispatches implement; the item is in-progress (pending), NOT yet
    // in-review — the ingest transition needs the subsequent sweep.
    await runScenario(world, {
      name: 'handoff-dispatch',
      initial: { issues: [readyIssue()] },
      steps: [{ sweep: {} }],
    });
    const afterDispatch = await world.gh.getIssue({ ...repo, number: 1 });
    expect(afterDispatch.labels).toContain(stateLabel('in-progress'));
    expect(afterDispatch.labels).not.toContain(stateLabel('in-review'));
    expect(world.backend.dispatched).toHaveLength(1);
    // The next sweep ingests and advances.
    await runScenario(
      { ...world, opts: world.opts },
      {
        name: 'handoff-ingest',
        steps: [{ sweep: {} }],
      },
    );
    const afterIngest = await world.gh.getIssue({ ...repo, number: 1 });
    expect(afterIngest.labels).toContain(stateLabel('in-review'));
  });

  it('gate block: a ready item missing acceptance criteria is not implemented (DoR)', async () => {
    const repoDir = await scaffoldActRepo();
    const world = makeWorld(repoDir);
    // An event-driven implement trigger isolates the implement loop (no sweep
    // scan of other states), so we observe the DoR gate alone.
    const result = await runScenario(world, {
      name: 'dor-block',
      initial: {
        issues: [
          {
            ref: { number: 1 },
            title: 'Vague ask',
            body: 'make it better', // no criteria block, no scope marker
            labels: [stateLabel('ready-for-agent')],
          },
        ],
      },
      steps: [
        {
          event: {
            name: 'issues',
            payload: {
              action: 'labeled',
              issue: { number: 1, author_association: 'OWNER' },
              label: { name: stateLabel('ready-for-agent') },
              sender: { login: 'dana', type: 'User' },
            },
          },
        },
      ],
    });
    // DoR blocked the implement loop — it never dispatched the unready item.
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement')).toEqual([]);
    expect((await world.gh.getIssue({ ...repo, number: 1 })).labels).not.toContain(
      stateLabel('in-review'),
    );
    // Whatever happened, the core invariants still hold.
    expect(checkInvariants({ gh: world.gh, records: result.runs })).toEqual([]);
  });

  it('fake-vs-replay equality: the same scenario over a replay cassette yields the same golden', async () => {
    const repoDir = await scaffoldActRepo();
    const fake = await runScenario(makeWorld(repoDir), IMPLEMENT_HAPPY);

    // Build a replay world whose cassette reproduces the implement exchange.
    const gh = new FakeGitHub();
    const records = new InMemoryRunRecordStore();
    const clock = new VirtualClock();
    const cassette: Cassette = {
      capabilities: {
        triggerModes: ['api_fire'],
        runsSandbox: true,
        secretPhase: 'full',
        network: 'on',
        opensPr: true,
        supportsReview: true,
        zdrCompatible: true,
        throughput: { tasksPerHour: null },
        quotaNote: 'replay',
      },
      exchanges: {
        implement: {
          // Match the FakeBackend's first session id so the persisted dispatch
          // marker (which embeds the handle JSON) is byte-identical — proving
          // the correlation/ingest path is backend-agnostic.
          signal: { kind: 'claude-session', sessionId: 'fake-session-1' },
          pr: { number: 9001, headRef: '{branch}', body: 'Implements {issue}.\n\n{trailer}' },
        },
      },
    };
    const replay = new ReplayBackend(gh, cassette, { id: 'claude' });
    const opts: ControllerOptions = {
      repoDir,
      repo,
      gh,
      backends: new Map([['claude', replay]]),
      records,
      botLogin: 'github-actions[bot]',
      now: clock.now,
    };
    const replayWorld: ScenarioWorld = { opts, gh, records, clock };
    const replayed = await runScenario(replayWorld, IMPLEMENT_HAPPY);

    expect(goldenJson(replayed.golden)).toEqual(goldenJson(fake.golden));
  });
});
