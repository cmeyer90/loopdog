import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '@loopdog/testing';
import { acquireClaim, clearExpiredClaim, releaseClaim, renewLease } from '@loopdog/github';
import { claimLabel, leaseLabel, lockLabel, stateLabel } from '@loopdog/core';

const NOW = new Date('2026-06-09T12:00:00Z');
const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };

function freshFake() {
  const gh = new FakeGitHub();
  gh.seedIssue({ ref, labels: [stateLabel('ready-for-agent')] });
  return gh;
}

describe('atomic claiming (0013)', () => {
  it('acquires, stamps the lease, and assigns the bot', async () => {
    const gh = freshFake();
    const result = await acquireClaim(gh, ref, 'run-a', {
      now: NOW,
      assignee: 'github-actions[bot]',
    });
    expect(result).toMatchObject({ acquired: true, leaseUntil: '2026-06-09T12:30:00.000Z' });
    const issue = await gh.getIssue(ref);
    expect(issue.labels).toContain(claimLabel('run-a'));
    expect(issue.labels).toContain(leaseLabel('2026-06-09T12:30:00.000Z'));
    expect(issue.assignees).toContain('github-actions[bot]');
  });

  it('two concurrent claimants → exactly one winner, loser releases cleanly', async () => {
    const gh = freshFake();
    const [a, b] = await Promise.all([
      acquireClaim(gh, ref, 'run-a', { now: NOW }),
      acquireClaim(gh, ref, 'run-b', { now: NOW }),
    ]);
    const winners = [a, b].filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
    expect(a.acquired).toBe(true); // lowest marker wins deterministically
    expect(b).toMatchObject({ acquired: false });
    const labels = await gh.getItemLabels(ref);
    expect(labels).toContain(claimLabel('run-a'));
    expect(labels).not.toContain(claimLabel('run-b'));
  });

  it('rejects a second claim while the first lease is live', async () => {
    const gh = freshFake();
    await acquireClaim(gh, ref, 'run-a', { now: NOW });
    const second = await acquireClaim(gh, ref, 'run-b', {
      now: new Date('2026-06-09T12:10:00Z'),
    });
    expect(second).toMatchObject({ acquired: false });
    expect((second as { reason: string }).reason).toContain('already claimed');
  });

  it('an expired lease is reclaimable by the sweep (crash recovery)', async () => {
    const gh = freshFake();
    await acquireClaim(gh, ref, 'run-a', { now: NOW, ttlMinutes: 30 });
    const later = new Date('2026-06-09T12:31:00Z');

    const cleared = await clearExpiredClaim(gh, ref, later);
    expect(cleared).toBe(true);
    const labels = await gh.getItemLabels(ref);
    expect(labels.filter((l) => l.startsWith('loopdog:claimed-by/'))).toEqual([]);

    const reclaim = await acquireClaim(gh, ref, 'run-c', { now: later });
    expect(reclaim.acquired).toBe(true);
  });

  it('does not clear a live claim', async () => {
    const gh = freshFake();
    await acquireClaim(gh, ref, 'run-a', { now: NOW });
    expect(await clearExpiredClaim(gh, ref, new Date('2026-06-09T12:05:00Z'))).toBe(false);
  });

  it('serialize_by defers a second item in the same area', async () => {
    const gh = freshFake();
    const other = { ...repo, number: 2 };
    gh.seedIssue({ ref: other, labels: [stateLabel('ready-for-agent')] });

    const first = await acquireClaim(gh, ref, 'run-a', { now: NOW, serializeArea: 'api' });
    expect(first.acquired).toBe(true);

    const second = await acquireClaim(gh, other, 'run-b', { now: NOW, serializeArea: 'api' });
    expect(second).toMatchObject({ acquired: false });
    expect((second as { reason: string }).reason).toContain("area 'api' locked by #1");

    // a different area is not blocked
    const otherArea = await acquireClaim(gh, other, 'run-b', { now: NOW, serializeArea: 'web' });
    expect(otherArea.acquired).toBe(true);
  });

  it('renewLease extends and replaces the lease label', async () => {
    const gh = freshFake();
    await acquireClaim(gh, ref, 'run-a', { now: NOW, ttlMinutes: 30 });
    const until = await renewLease(gh, ref, {
      now: new Date('2026-06-09T12:20:00Z'),
      ttlMinutes: 30,
    });
    expect(until).toBe('2026-06-09T12:50:00.000Z');
    const labels = await gh.getItemLabels(ref);
    expect(labels.filter((l) => l.startsWith('loopdog:lease/'))).toEqual([
      leaseLabel('2026-06-09T12:50:00.000Z'),
    ]);
  });

  it('releaseClaim removes claim/lease/lock and unassigns', async () => {
    const gh = freshFake();
    await acquireClaim(gh, ref, 'run-a', {
      now: NOW,
      assignee: 'github-actions[bot]',
      serializeArea: 'api',
    });
    await releaseClaim(gh, ref, { assignee: 'github-actions[bot]' });
    const issue = await gh.getIssue(ref);
    expect(issue.labels).toEqual([stateLabel('ready-for-agent')]);
    expect(issue.assignees).toEqual([]);
    expect(issue.labels).not.toContain(lockLabel('api'));
  });
});
