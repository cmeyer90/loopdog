import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  IngestResult,
  WorkBrief,
} from '@looper/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';

/**
 * Scripted fake `ExecutionBackend` (task 0084): deterministic, offline, zero
 * quota. Behavior per dispatch is scripted:
 *  - 'open-pr'        → the "agent" opens a correlatable PR on the fake GitHub
 *                       (honoring branch+trailer) after `pendingIngests` polls
 *  - 'silent'         → never produces anything (ingest stays pending)
 *  - 'fail-dispatch'  → dispatch throws (provider error)
 *  - 'fail-ingest'    → ingest reports failure
 *  - 'rogue-pr'       → opens a PR that IGNORES the branch/trailer contract
 *                       (exercises the dispatch-time-signal fallback, 0093)
 */
export type FakeBehavior = 'open-pr' | 'silent' | 'fail-dispatch' | 'fail-ingest' | 'rogue-pr';

export class FakeBackend implements ExecutionBackend {
  readonly id: string;
  behavior: FakeBehavior = 'open-pr';
  /** How many ingest polls return pending before completion. */
  pendingIngests = 0;
  readonly dispatched: WorkBrief[] = [];
  private sessions = 0;
  private polls = new Map<string, number>();

  constructor(
    private readonly gh: FakeGitHub,
    opts: { id?: string } = {},
  ) {
    this.id = opts.id ?? 'fake';
  }

  capabilities(): BackendCapabilities {
    return {
      triggerModes: ['api_fire'],
      runsSandbox: true,
      secretPhase: 'full',
      network: 'on',
      opensPr: true,
      supportsReview: true,
      zdrCompatible: true,
      throughput: { tasksPerHour: null },
      quotaNote: 'fake backend — unlimited, free',
    };
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    if (this.behavior === 'fail-dispatch') {
      throw new Error('fake provider: dispatch failed (simulated outage)');
    }
    this.dispatched.push(brief);
    const sessionId = `fake-session-${++this.sessions}`;
    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt: new Date(0).toISOString(),
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: { kind: 'claude-session', sessionId },
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    if (this.behavior === 'silent') return { status: 'pending' };
    if (this.behavior === 'fail-ingest') {
      return { status: 'failed', reason: 'fake provider: work cell crashed (simulated)' };
    }

    const polls = (this.polls.get(handle.runId) ?? 0) + 1;
    this.polls.set(handle.runId, polls);
    if (polls <= this.pendingIngests) return { status: 'pending' };

    if (handle.expectation === 'pull-request') {
      const obeys = this.behavior !== 'rogue-pr';
      const headRef = obeys ? handle.expectedBranch : `agent/whimsical-branch-${polls}`;
      const body = obeys
        ? `Implements the brief.\n\n${handle.expectedTrailer}`
        : 'Implements the brief. (no trailer)';
      // Find or create the provider's PR on the fake GitHub.
      const existing = await this.gh.listPullRequestsByHeadPrefix(
        { owner: handle.item.owner, repo: handle.item.repo },
        headRef,
      );
      const pr =
        existing[0] ??
        this.gh.seedPull({
          ref: { owner: handle.item.owner, repo: handle.item.repo, number: 9000 + this.sessions },
          headRef,
          title: `looper run ${handle.runId}`,
          body,
          author: { login: 'fake-provider[bot]', type: 'Bot' },
        });
      return {
        status: 'completed',
        pr,
        matchedBy: obeys ? 'branch-name' : 'dispatch-signal',
      };
    }
    return { status: 'completed', matchedBy: 'dispatch-signal' };
  }
}
