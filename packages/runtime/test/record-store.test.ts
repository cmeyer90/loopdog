import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '@loopdog/testing';
import { TelemetryBranchStore } from '@loopdog/runtime';
import type { RunRecord } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };

function rec(at: string): RunRecord {
  return {
    runId: `run-${at}`,
    loop: 'groom',
    backend: 'claude',
    item: { owner: 'o', repo: 'r', number: 1 },
    trigger: { at, kind: 'event', name: 'manual.run' },
    steps: [],
    outcome: { status: 'done' },
  } as unknown as RunRecord;
}

/** Count FakeGitHub operations from this point on. */
function counting(gh: FakeGitHub): Record<string, number> {
  const calls: Record<string, number> = {};
  gh.beforeOp = (op) => {
    calls[op] = (calls[op] ?? 0) + 1;
  };
  return calls;
}

function windowDays(end: string, days: number): string[] {
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, back) =>
    new Date(endMs - back * 86_400_000).toISOString().slice(0, 10),
  );
}

describe('TelemetryBranchStore window reads (no per-day 404 storm)', () => {
  it('a fresh repo with no telemetry branch reads zero per-day files', async () => {
    const gh = new FakeGitHub();
    const store = new TelemetryBranchStore(gh, repo);
    const calls = counting(gh);

    const out: RunRecord[] = [];
    for (const day of windowDays('2026-06-13', 31)) out.push(...(await store.readDay(day)));

    expect(out).toEqual([]);
    expect(calls['listDir'] ?? 0).toBe(1); // one listing, then cached
    expect(calls['readFile'] ?? 0).toBe(0); // never a per-day GET
  });

  it('a sparse branch reads only the day-buckets that exist', async () => {
    const gh = new FakeGitHub();
    const store = new TelemetryBranchStore(gh, repo);
    await store.append(rec('2026-06-10T08:00:00.000Z'));

    const calls = counting(gh); // count only the reads below
    const out: RunRecord[] = [];
    for (const day of windowDays('2026-06-13', 31)) out.push(...(await store.readDay(day)));

    expect(out.map((r) => r.runId)).toEqual(['run-2026-06-10T08:00:00.000Z']);
    expect(calls['readFile'] ?? 0).toBe(1); // exactly the one existing bucket, not 31
  });
});
