import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  IngestResult,
  WorkBrief,
} from '@looper/core';
import { ingestViaCorrelation } from '../correlation/correlate.js';

/**
 * The Codex subscription backend (task 0021): the ONLY unattended dispatch
 * surface is a GitHub `@codex` mention/assignment — no REST API. Dispatch is
 * a comment via the GitHub port (the controller's token; no Codex credential
 * is ever held). There is NO dispatch-time provider id, so correlation leans
 * on the 0073 branch/trailer/issue-ref scheme entirely.
 *
 * Honest caveat (0092/0093): Codex resolves quota through the COMMENTER's
 * linked ChatGPT account — a bot identity with no linked account may not
 * trigger Codex at all. The mention token (the adopter's own attributable
 * identity) is the documented workaround; the live spike verifies it.
 */
export class CodexBackend implements ExecutionBackend {
  readonly id = 'codex';
  constructor(
    private readonly opts: {
      gh: GitHubPort;
      now?: () => Date;
      /** Lower-tier default ~5 cloud tasks/hr; config-overridable. */
      tasksPerHour?: number;
    },
  ) {}

  capabilities(): BackendCapabilities {
    return {
      triggerModes: ['mention'],
      runsSandbox: true,
      secretPhase: 'setup-only', // secrets STRIPPED before the agent phase
      network: 'off', // agent-phase internet disabled by default
      opensPr: true,
      supportsReview: true,
      zdrCompatible: false,
      throughput: { tasksPerHour: this.opts.tasksPerHour ?? 5 },
      quotaNote: '~5 cloud tasks/hr on lower tiers; modeled from run-record timestamps',
    };
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    // Review expectation → `@codex review` on the PR; otherwise a cloud task.
    const body =
      brief.expectation === 'comment'
        ? `@codex review\n\n${brief.instructions}`
        : `@codex ${brief.instructions}`;
    const { id } = await this.opts.gh.createComment(brief.item, body);
    const mentionedAt = (this.opts.now?.() ?? new Date()).toISOString();
    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt: mentionedAt,
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: { kind: 'codex-mention', commentId: id, mentionedAt },
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    if (handle.expectation === 'comment') {
      // Review verdict: a NEW comment (not our mention) from a bot after dispatch.
      const comments = await this.opts.gh.listComments(handle.item);
      const verdict = comments.find(
        (c) =>
          c.id !== (handle.signal.kind === 'codex-mention' ? handle.signal.commentId : -1) &&
          c.author.type === 'Bot' &&
          Date.parse(c.createdAt) >= Date.parse(handle.dispatchedAt) &&
          /codex/i.test(c.author.login),
      );
      if (verdict)
        return { status: 'completed', commentId: verdict.id, matchedBy: 'dispatch-signal' };
      return { status: 'pending' };
    }
    return ingestViaCorrelation(this.opts.gh, handle);
  }
}
