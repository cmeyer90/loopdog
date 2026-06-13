import { describe, expect, it } from 'vitest';
import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  IngestResult,
  WorkBrief,
} from '@looper/core';
import { FakeGitHub, runLiveSmoke, cleanupScratch } from '@looper/testing';
import { stateLabel } from '@looper/core';

/**
 * Live-smoke harness logic (task 0087) — verified HERMETICALLY (tiers 1–4) with
 * stub backends so the control flow (passed / skipped-on-rate-cap / failed-on-
 * timeout / drift) is proven offline. The REAL-subscription run lives in
 * `*.live.test.ts` (tier 5) and is operator-gated; this proves the harness it
 * drives behaves correctly without spending a cent of quota.
 */

const repo = { owner: 'o', repo: 'r' };
const item = { ...repo, number: 1 };

const CAPS: BackendCapabilities = {
  triggerModes: ['api_fire'],
  runsSandbox: true,
  secretPhase: 'full',
  network: 'on',
  opensPr: true,
  supportsReview: true,
  zdrCompatible: true,
  throughput: { tasksPerHour: null },
  quotaNote: 'stub',
};

function brief(): WorkBrief {
  return {
    runId: 'run-implement-1-a0-deadbeef',
    loop: 'implement',
    item,
    backend: 'claude',
    expects: 'pull-request',
    expectedBranch: 'looper/implement/1-run',
    expectedTrailer: 'looper-run: run-implement-1-a0-deadbeef',
    expectation: 'pull-request',
    briefRef: 'implement/prompt.md@abc',
    prompt: 'do the thing',
  } as unknown as WorkBrief;
}

const expected = {
  capabilities: CAPS,
  api: { triggerMode: 'api_fire' },
  correlation: { branchPrefix: 'looper/implement', trailerKey: 'looper-run', linksIssue: true },
};

/** A scripted backend whose dispatch/ingest behavior the test chooses. */
function stubBackend(opts: {
  dispatchThrows?: string;
  ingest: () => IngestResult;
}): ExecutionBackend {
  return {
    id: 'claude',
    capabilities: () => CAPS,
    async dispatch(b: WorkBrief): Promise<DispatchHandle> {
      if (opts.dispatchThrows) throw new Error(opts.dispatchThrows);
      return {
        runId: b.runId,
        backend: 'claude',
        item: b.item,
        dispatchedAt: new Date(0).toISOString(),
        expectedBranch: b.expectedBranch,
        expectedTrailer: b.expectedTrailer,
        expectation: b.expectation,
        signal: { kind: 'claude-session', sessionId: 's1' },
      };
    },
    async ingest(): Promise<IngestResult> {
      return opts.ingest();
    },
  };
}

describe('live-smoke harness (0087, hermetic logic check)', () => {
  it('passes when the provider opens a correlated PR and the item advanced one edge', async () => {
    const gh = new FakeGitHub();
    await gh.ensureBranch(repo, 'main');
    gh.seedIssue({ ref: item, labels: [stateLabel('in-progress')] });
    const pr = gh.seedPull({ ref: { ...repo, number: 7 }, headRef: 'looper/implement/1-run' });
    const backend = stubBackend({
      ingest: () => ({ status: 'completed', pr, matchedBy: 'branch-name' }),
    });
    const result = await runLiveSmoke({
      gh,
      backend,
      provider: 'claude',
      item,
      brief: brief(),
      expected,
    });
    expect(result.status).toBe('passed');
    expect(result.prNumber).toBe(7);
  });

  it('reports SKIPPED (not failed) when the provider is rate-capped', async () => {
    const gh = new FakeGitHub();
    const backend = stubBackend({
      dispatchThrows: 'rate limit exceeded (429 Too Many Requests)',
      ingest: () => ({ status: 'pending' }),
    });
    const result = await runLiveSmoke({
      gh,
      backend,
      provider: 'claude',
      item,
      brief: brief(),
      expected,
    });
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toMatch(/rate-capped/);
  });

  it('reports FAILED with a timeout diagnostic when no PR appears in the bounded wait', async () => {
    const gh = new FakeGitHub();
    await gh.ensureBranch(repo, 'main');
    gh.seedIssue({ ref: item, labels: [stateLabel('in-progress')] });
    let clock = 0;
    const backend = stubBackend({ ingest: () => ({ status: 'pending' }) });
    const result = await runLiveSmoke({
      gh,
      backend,
      provider: 'claude',
      item,
      brief: brief(),
      expected,
      waitMs: 1000,
      pollMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result.status).toBe('failed');
    expect(result.failure).toMatch(/timeout/);
  });

  it('flags capability drift on an otherwise-successful run', async () => {
    const gh = new FakeGitHub();
    await gh.ensureBranch(repo, 'main');
    gh.seedIssue({ ref: item, labels: [stateLabel('in-progress')] });
    const pr = gh.seedPull({ ref: { ...repo, number: 7 }, headRef: 'looper/implement/1-run' });
    const backend = stubBackend({
      ingest: () => ({ status: 'completed', pr, matchedBy: 'branch-name' }),
    });
    // Expected fingerprint declares zdrCompatible:false → drift vs live caps.
    const result = await runLiveSmoke({
      gh,
      backend,
      provider: 'claude',
      item,
      brief: brief(),
      expected: { ...expected, capabilities: { ...CAPS, zdrCompatible: false } },
    });
    expect(result.status).toBe('failed');
    expect(result.drift?.drifted).toBe(true);
  });

  it('cleanupScratch removes looper labels and runs the operator closer', async () => {
    const gh = new FakeGitHub();
    gh.seedIssue({
      ref: item,
      labels: [stateLabel('in-progress'), 'looper:claimed-by/x', 'keep-me'],
    });
    let closed = false;
    await cleanupScratch(gh, item, async () => {
      closed = true;
    });
    const labels = await gh.getItemLabels(item);
    expect(labels).toEqual(['keep-me']); // looper:* removed, foreign label kept
    expect(closed).toBe(true);
  });
});
