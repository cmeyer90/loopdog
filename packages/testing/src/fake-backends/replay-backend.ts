import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  IngestResult,
  PullRequestSnapshot,
  WorkBrief,
} from '@loopdog/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';

/**
 * Replay (cassette) backend (task 0084): record-once against a real provider,
 * replay the recorded dispatch/ingest exchange deterministically in CI — so a
 * tier-2 component test exercises the REAL ingest/correlation path against a
 * faithful recording, with zero quota and no network.
 *
 * A cassette is a plain JSON object (no SDK, no secrets — scrub before
 * committing). The replay backend seeds the recorded PR onto the fake GitHub
 * at dispatch so `ingest` runs the real correlation matcher against it.
 */
export interface Cassette {
  capabilities: BackendCapabilities;
  /** Keyed by loop name (or '*' default). */
  exchanges: Record<string, CassetteExchange | undefined>;
}

export interface CassetteExchange {
  /** The dispatch-time signal the provider returned. */
  signal: DispatchHandle['signal'];
  /** The PR the provider opened (replayed onto fake GitHub at dispatch). */
  pr?: {
    number: number;
    /** '{branch}' / '{trailer}' / '{issue}' placeholders expand from the brief. */
    headRef: string;
    body: string;
    author?: { login: string; type: 'Bot' | 'User' };
  };
  /** Polls returning pending before the PR appears. */
  pendingIngests?: number;
}

export class ReplayBackend implements ExecutionBackend {
  readonly id: string;
  private polls = new Map<string, number>();

  constructor(
    private readonly gh: FakeGitHub,
    private readonly cassette: Cassette,
    opts: { id?: string } = {},
  ) {
    this.id = opts.id ?? 'replay';
  }

  capabilities(): BackendCapabilities {
    return this.cassette.capabilities;
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    const exchange = this.cassette.exchanges[brief.loop] ?? this.cassette.exchanges['*'];
    if (!exchange) throw new Error(`replay: no cassette exchange for loop '${brief.loop}'`);
    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt: new Date(0).toISOString(),
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: exchange.signal,
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    const loop = handle.runId.match(/^run-([a-z0-9-]+?)-\d+/)?.[1] ?? '*';
    const exchange = this.cassette.exchanges[loop] ?? this.cassette.exchanges['*'];
    if (!exchange?.pr) {
      // comment-only / no-PR recordings ingest as completed-comment or pending.
      return { status: 'pending' };
    }
    const polls = (this.polls.get(handle.runId) ?? 0) + 1;
    this.polls.set(handle.runId, polls);
    if (polls <= (exchange.pendingIngests ?? 0)) return { status: 'pending' };

    // Replay the recorded PR onto fake GitHub, expanding brief placeholders,
    // then run the REAL correlation matcher via the fake's listing.
    const repo = { owner: handle.item.owner, repo: handle.item.repo };
    const headRef = expand(exchange.pr.headRef, handle);
    const existing = await this.gh.listPullRequestsByHeadPrefix(repo, headRef, { state: 'all' });
    const pr: PullRequestSnapshot =
      existing[0] ??
      this.gh.seedPull({
        ref: { ...repo, number: exchange.pr.number },
        headRef,
        body: expand(exchange.pr.body, handle),
        author: exchange.pr.author ?? { login: 'replay-provider[bot]', type: 'Bot' },
      });
    const matchedBy = pr.headRef === handle.expectedBranch ? 'branch-name' : 'pr-trailer';
    return { status: 'completed', pr, matchedBy };
  }
}

function expand(template: string, handle: DispatchHandle): string {
  return template
    .replaceAll('{branch}', handle.expectedBranch)
    .replaceAll('{trailer}', handle.expectedTrailer)
    .replaceAll('{issue}', `#${handle.item.number}`);
}
