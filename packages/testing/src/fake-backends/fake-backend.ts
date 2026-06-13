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
  /**
   * Scripted work-cell simulation, run once at ingest-completion time (e.g.
   * "groom the issue body", "post a verdict comment"). Receives the fake and
   * the handle; the trailer comment/PR is still created by the backend.
   */
  simulate?: (gh: FakeGitHub, handle: DispatchHandle) => Promise<void>;
  /** Verdict line appended to comment-shaped results (e.g. 'looper-verdict: ready'). */
  resultVerdict?: string;
  private sessions = 0;
  private polls = new Map<string, number>();
  private simulated = new Set<string>();

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

    if (this.simulate && !this.simulated.has(handle.runId)) {
      this.simulated.add(handle.runId);
      await this.simulate(this.gh, handle);
    }

    if (handle.expectation === 'pull-request') {
      const obeys = this.behavior !== 'rogue-pr';
      const headRef = obeys ? handle.expectedBranch : `agent/whimsical-branch-${polls}`;
      const body = obeys
        ? `Implements #${handle.item.number}.\n\n${handle.expectedTrailer}`
        : 'Implements the brief. (no trailer)';
      // Find or create the provider's PR on the fake GitHub.
      const repoRef = { owner: handle.item.owner, repo: handle.item.repo };
      const existing = await this.gh.listPullRequestsByHeadPrefix(repoRef, headRef);
      // PR numbers derive from the fake's total PR count so two backend
      // instances never collide on the same number.
      const allPrs = await this.gh.listPullRequestsByHeadPrefix(repoRef, '', { state: 'all' });
      const pr =
        existing[0] ??
        this.gh.seedPull({
          ref: { ...repoRef, number: 9001 + allPrs.length },
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
    // comment / plan-update results: post the work cell's summary comment
    // (with the verdict line + trailer) as the provider bot.
    const previousActor = this.gh.actor;
    this.gh.actor = { login: `${this.id}-provider[bot]`, type: 'Bot' };
    const { id } = await this.gh.createComment(
      handle.item,
      [
        'Work cell summary.',
        ...(this.resultVerdict ? [this.resultVerdict] : []),
        '',
        handle.expectedTrailer,
      ].join('\n'),
    );
    this.gh.actor = previousActor;
    return { status: 'completed', commentId: id, matchedBy: 'dispatch-signal' };
  }
}
