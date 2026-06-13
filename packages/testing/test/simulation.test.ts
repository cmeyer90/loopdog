import { afterAll, describe, expect, it } from 'vitest';
import { stateLabel } from '@looper/core';
import {
  Sim,
  checkInvariants,
  crashMidRun,
  duplicateWebhook,
  eventStorm,
  fuzz,
  raceEventSweep,
  sweepRecovery,
  type Action,
} from '@looper/testing';
import { cleanup, GROOMED_BODY, makeWorld, repo, scaffoldActRepo } from './helpers.js';

/**
 * Simulation & fault injection (task 0086): drive the REAL controller through
 * the hard concurrency cases — event storms, event↔sweep races, dropped &
 * duplicated webhooks, mid-run crashes — under a deterministic virtual clock,
 * asserting the core invariants (no double-dispatch, no stranded items,
 * idempotent ingest, claim exclusivity, monotonic state) hold throughout.
 */

afterAll(cleanup);

const READY = {
  ref: { number: 1 },
  title: 'Add rate limiting',
  body: GROOMED_BODY,
  labels: [stateLabel('ready-for-agent')],
  author: { login: 'dana' as const, type: 'User' as const },
};

const labeled: Action = {
  kind: 'event',
  name: 'issues',
  payload: {
    action: 'labeled',
    issue: { number: 1, author_association: 'OWNER' },
    label: { name: stateLabel('ready-for-agent') },
    sender: { login: 'dana', type: 'User' },
  },
};

async function freshSim() {
  const repoDir = await scaffoldActRepo();
  const world = makeWorld(repoDir);
  await world.gh.ensureBranch(repo, 'main');
  world.gh.seedIssue({ ...READY, ref: { ...repo, number: 1 } });
  const sim = new Sim({ opts: world.opts, gh: world.gh, clock: world.clock });
  return { world, sim };
}

describe('simulation & fault injection (0086)', () => {
  it('event storm on one item yields ≤1 dispatch (noDoubleDispatch)', async () => {
    const { world, sim } = await freshSim();
    await sim.step(eventStorm('issues', labeled.payload, 5));
    await sim.runToQuiescence();
    // The claim + idempotency key collapsed five near-simultaneous events.
    expect(
      world.backend.dispatched.filter((b) => b.loop === 'implement').length,
    ).toBeLessThanOrEqual(1);
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement').length).toBe(1);
  });

  it('event↔sweep race advances the item exactly once', async () => {
    const { world, sim } = await freshSim();
    await sim.step(raceEventSweep('issues', labeled.payload));
    await sim.runToQuiescence();
    // Both the event and the sweep selected the item; only one claimed + dispatched.
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(1);
  });

  it('a dropped webhook is recovered by the sweep, not stranded (noStrandedItems)', async () => {
    const { world, sim } = await freshSim();
    // The triggering event is silently lost; only the sweep can recover it.
    for (const a of sweepRecovery(120_000)) await sim.step(a);
    await sim.runToQuiescence();
    // The sweep picked the item up and dispatched it — nothing stranded.
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(1);
    expect(
      checkInvariants({ gh: world.gh, records: world.records.records, now: world.clock.now }),
    ).toEqual([]);
  });

  it('a duplicated webhook produces exactly one ingest effect (idempotentIngest)', async () => {
    const { world, sim } = await freshSim();
    for (const a of duplicateWebhook('issues', labeled.payload, 3)) await sim.step(a);
    await sim.runToQuiescence();
    expect(world.backend.dispatched.filter((b) => b.loop === 'implement')).toHaveLength(1);
    // One correlated PR, despite three deliveries.
    const prs = await world.gh.listPullRequestsByHeadPrefix(repo, 'looper/implement/', {
      state: 'all',
    });
    expect(prs).toHaveLength(1);
  });

  it('a crash mid-dispatch releases the claim and recovers (no orphaned claim, no stranding)', async () => {
    const { world, sim } = await freshSim();
    // Crash during the dispatch marker write (the first createComment). The
    // runtime's dispatch guard catches it, releases the claim, and records the
    // failed attempt — a partial dispatch must NOT orphan the claim.
    const crashed = await sim.step(crashMidRun('createComment', 1, labeled));
    expect(crashed.violations).toEqual([]); // no invariant tripped by the abort
    const afterCrash = await world.gh.getIssue({ ...repo, number: 1 });
    expect(afterCrash.labels.some((l) => l.startsWith('looper:claimed-by/'))).toBe(false); // released
    // A later sweep retries the (now claim-free) item and drives it forward.
    await sim.runToQuiescence(8, 20 * 60_000); // 20-min ticks beat a 30-min lease
    expect(
      world.backend.dispatched.filter((b) => b.loop === 'implement').length,
    ).toBeGreaterThanOrEqual(1);
    // Across the whole run: no double-dispatch (failed attempt → legal retry),
    // idempotent ingest, no stranded items.
    expect(
      checkInvariants({ gh: world.gh, records: world.records.records, now: world.clock.now }),
    ).toEqual([]);
  });

  it('fuzz: invariants hold across a fixed seed set (or prints a minimal repro)', async () => {
    const repoDir = await scaffoldActRepo();
    const result = await fuzz({
      seeds: 8,
      makeWorld: async () => {
        const world = makeWorld(repoDir);
        await world.gh.ensureBranch(repo, 'main');
        world.gh.seedIssue({ ...READY, ref: { ...repo, number: 1 } });
        return { opts: world.opts, gh: world.gh };
      },
      actions: [labeled, { kind: 'sweep' }, raceEventSweep('issues', labeled.payload)],
      quiesceTicks: 4,
    });
    if (result.violation) {
      throw new Error(
        `fuzz found a violation at seed ${result.violation.seed}: ` +
          `${result.violation.invariant} (${result.violation.detail})\n` +
          `minimal schedule: ${result.violation.schedule.join(' → ')}\n` +
          `trace:\n  ${result.violation.trace.join('\n  ')}`,
      );
    }
    expect(result.ran).toBe(8);
  });
});
