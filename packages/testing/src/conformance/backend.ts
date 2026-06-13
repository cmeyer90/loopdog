import { describe, expect, it } from 'vitest';
import type { ExecutionBackend, WorkBrief } from '@looper/core';
import { FakeGitHub } from '../fake-github/fake-github.js';

/**
 * Backend conformance kit (task 0084): one suite every `ExecutionBackend` must
 * pass — scripted fake, replay backend, and (operator-run) the real backends —
 * proving the dispatch→ingest contract (0012/0073) holds uniformly. Hermetic:
 * the fake/replay backends spend ZERO quota; only the real backends would.
 */
export interface BackendConformanceOpts {
  name: string;
  /** Build the backend under test over the given fake GitHub. */
  makeBackend: (gh: FakeGitHub) => ExecutionBackend;
  /** Whether this backend opens a PR (vs a comment-shaped result). */
  opensPr?: boolean;
}

const repo = { owner: 'o', repo: 'r' };
const item = { ...repo, number: 1 };

function brief(): WorkBrief {
  return {
    runId: 'run-implement-1-a0-deadbeef',
    loop: 'implement',
    item,
    briefRef: 'implement/prompt.md@abc1234',
    instructions: 'Implement the thing.',
    expectedBranch: 'looper/implement/1-run-implement-1-a0-deadbeef',
    expectedTrailer: 'looper-run: run-implement-1-a0-deadbeef',
    expectation: 'pull-request',
  };
}

export function runBackendConformance(opts: BackendConformanceOpts): void {
  describe(`backend conformance — ${opts.name}`, () => {
    it('declares a well-formed capability shape', () => {
      const gh = new FakeGitHub();
      const caps = opts.makeBackend(gh).capabilities();
      expect(caps.triggerModes.length).toBeGreaterThan(0);
      expect(typeof caps.opensPr).toBe('boolean');
      expect(caps.throughput).toHaveProperty('tasksPerHour');
      expect(['full', 'setup-only', 'none']).toContain(caps.secretPhase);
    });

    it('dispatch returns a handle carrying the three correlation signals', async () => {
      const gh = new FakeGitHub();
      await gh.ensureBranch(repo, 'main');
      gh.seedIssue({ ref: item });
      const handle = await opts.makeBackend(gh).dispatch(brief());
      expect(handle.runId).toBe('run-implement-1-a0-deadbeef');
      expect(handle.expectedBranch).toContain('looper/implement/1-');
      expect(handle.expectedTrailer).toContain('looper-run:');
      expect(handle.expectation).toBe('pull-request');
      expect(handle.signal).toBeDefined();
    });

    it('ingest correlates the provider PR and is idempotent under re-delivery', async () => {
      const gh = new FakeGitHub();
      await gh.ensureBranch(repo, 'main');
      gh.seedIssue({ ref: item });
      const backend = opts.makeBackend(gh);
      const handle = await backend.dispatch(brief());

      const first = await backend.ingest(handle);
      expect(first.status).toBe('completed');
      const firstPr = first.status === 'completed' ? first.pr : undefined;
      if (opts.opensPr !== false) {
        expect(firstPr).toBeDefined();
        if (first.status === 'completed') expect(first.matchedBy).toBeDefined();
      }

      // Re-deliver: ingesting the same handle again yields the SAME effect —
      // the existing PR is re-found, not duplicated (0073 idempotency).
      const before = (await gh.listPullRequestsByHeadPrefix(repo, '', { state: 'all' })).length;
      const second = await backend.ingest(handle);
      const after = (await gh.listPullRequestsByHeadPrefix(repo, '', { state: 'all' })).length;
      expect(after).toBe(before); // no duplicate PR
      const secondPr = second.status === 'completed' ? second.pr : undefined;
      if (opts.opensPr !== false && firstPr && secondPr) {
        expect(secondPr.ref.number).toBe(firstPr.ref.number);
      }
    });
  });
}
