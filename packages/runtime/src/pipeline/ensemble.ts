import type {
  IssueSnapshot,
  LoopDefinition,
  PullRequestSnapshot,
  RunRecord,
  RunStep,
} from '@looper/core';
import { stateLabel } from '@looper/core';
import { releaseClaim } from '@looper/github';
import { composeWorkBrief, promptSourceFromReader } from './brief.js';
import {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './dispatch-marker.js';
import type { PendingDispatch } from './dispatch-marker.js';
import type { EffectGate } from './effect-gate.js';
import type { RunnerDeps } from './transition-runner.js';

/**
 * Ensemble & judge (M13 · 0055, tier:core only): dispatch the SAME brief to
 * two distinct providers, then dispatch a judge that compares the two PRs
 * against the acceptance criteria and picks a winner (`looper-winner: #N`).
 * The loser is labeled abandoned with an explanation; the winner advances.
 */

const WINNER_RE = /looper-winner:\s*#?(\d+)/i;

export function parseWinner(body: string): number | null {
  const m = body.match(WINNER_RE);
  return m ? Number(m[1]) : null;
}

/** The two attempt providers: distinct, subscription-first. */
export function ensembleProviders(available: readonly string[]): [string, string] | null {
  const preferred = ['claude', 'codex', 'self-hosted'].filter((b) => available.includes(b));
  if (preferred.length < 2) return null;
  return [preferred[0]!, preferred[1]!];
}

export async function ensembleDispatch(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  runId: string,
  gate: EffectGate,
  step: (kind: RunStep['kind'], detail: string) => void,
): Promise<boolean> {
  const providers = ensembleProviders([...deps.backends.keys()]);
  if (!providers) {
    step('dispatch', 'ensemble needs two distinct backends — falling back to single dispatch');
    return false;
  }
  const source = deps.promptSource ?? promptSourceFromReader(deps.readPrompt, loop);
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const backend = deps.backends.get(provider)!;
    const brief = await composeWorkBrief({
      loop: { ...loop, backend: provider },
      item,
      runId: `${runId}-e${i + 1}`,
      source,
      defaultBranch: deps.defaultBranch,
    });
    const handle = await gate.dispatch(`ensemble attempt ${i + 1} on ${provider}`, () =>
      backend.dispatch(brief),
    );
    if (handle) {
      await gate.mutate('comment', `persist ensemble handle ${i + 1}`, () =>
        deps.gh.createComment(item.ref, renderDispatchMarker(handle)).then(() => {}),
      );
      step('dispatch', `ensemble ${i + 1}/${providers.length} via ${provider}`);
    }
  }
  return true;
}

export async function ensembleIngest(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  pendings: PendingDispatch[],
  gate: EffectGate,
  step: (kind: RunStep['kind'], detail: string) => void,
  record: (outcome: RunRecord['outcome'], briefRef?: string) => RunRecord,
): Promise<RunRecord | null> {
  const judgePending = pendings.find((p) => p.handle.runId.endsWith('-judge'));

  if (judgePending) {
    const backend = deps.backends.get(judgePending.handle.backend);
    if (!backend) return null;
    const result = await backend.ingest(judgePending.handle);
    step('ingest', `judge: ${result.status}`);
    if (result.status === 'pending') return null;
    if (result.status === 'failed') {
      await escalate(deps, item, gate, `ensemble judge failed: ${result.reason}`);
      return record({ status: 'escalated', failure: { class: 'terminal', reason: result.reason } });
    }

    const comments = await deps.gh.listComments(item.ref);
    const verdictBody =
      result.commentId !== undefined
        ? (comments.find((c) => c.id === result.commentId)?.body ?? '')
        : '';
    const winner = parseWinner(verdictBody);
    if (winner === null) {
      await escalate(
        deps,
        item,
        gate,
        'ensemble judge returned no looper-winner verdict (fail closed)',
      );
      return record({
        status: 'escalated',
        failure: { class: 'terminal', reason: 'no judge winner verdict' },
      });
    }

    // Advance the item; promote the winner PR; retire the loser with context.
    const candidates = await collectEnsemblePrs(deps, item, pendings);
    const winnerPr = candidates.find((pr) => pr.ref.number === winner);
    const losers = candidates.filter((pr) => pr.ref.number !== winner);
    await gate.mutate('label', `state -> ${loop.transition.to}`, async () => {
      const labels = await deps.gh.getItemLabels(item.ref);
      await deps.gh.addLabels(item.ref, [stateLabel(loop.transition.to)]);
      const current = labels.find((l) => l.startsWith('looper:state/'));
      if (current && current !== stateLabel(loop.transition.to)) {
        await deps.gh.removeLabel(item.ref, current);
      }
    });
    if (winnerPr) {
      await gate.mutate('label', `label winner PR #${winnerPr.ref.number}`, () =>
        deps.gh.addLabels(winnerPr.ref, [stateLabel(loop.transition.to)]),
      );
    }
    for (const loser of losers) {
      await gate.mutate('label', `retire loser PR #${loser.ref.number}`, () =>
        deps.gh.addLabels(loser.ref, ['looper:abandoned']),
      );
      await gate.comment('loser notice', () =>
        deps.gh.createComment(
          loser.ref,
          `🏁 ensemble judge selected #${winner} for this work — closing this attempt. ` +
            'The judging rationale is on the source issue.',
        ),
      );
    }
    for (const pending of pendings) {
      const marker = comments.find((c) => c.id === pending.commentId);
      if (marker) {
        await gate.mutate('comment', 'resolve ensemble marker', () =>
          deps.gh.updateComment(
            item.ref,
            pending.commentId,
            markDispatchResolved(marker.body, `ensemble decided: winner #${winner}`),
          ),
        );
      }
    }
    await gate.mutate('claim', 'release', () =>
      releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
    );
    return record({
      status: 'done',
      transition: `${loop.transition.from}->${loop.transition.to}`,
      artifacts: { pr: winner },
    });
  }

  // Work handles: ingest each attempt; wait until EVERY one has a PR, then
  // dispatch the judge.
  const prs: PullRequestSnapshot[] = [];
  for (const pending of pendings) {
    const backend = deps.backends.get(pending.handle.backend);
    if (!backend) return null;
    const result = await backend.ingest(pending.handle);
    if (result.status === 'pending') return null; // attempts still running
    if (result.status === 'failed') {
      await escalate(deps, item, gate, `ensemble attempt failed: ${result.reason}`);
      return record({ status: 'escalated', failure: { class: 'terminal', reason: result.reason } });
    }
    if (result.pr) prs.push(result.pr);
  }
  if (prs.length < pendings.length) return null;

  const judgeBackendId =
    loop.ensemble?.judge ?? loop.reviewBackend ?? (loop.backend === 'claude' ? 'codex' : 'claude');
  const judgeBackend = deps.backends.get(judgeBackendId);
  if (!judgeBackend) {
    await escalate(deps, item, gate, `ensemble judge backend '${judgeBackendId}' not registered`);
    return record({
      status: 'escalated',
      failure: { class: 'terminal', reason: 'judge backend missing' },
    });
  }
  const runId = pendings[0]!.handle.runId.replace(/-e\d+$/, '');
  const judgeBrief = {
    runId: `${runId}-judge`,
    loop: loop.name,
    item: item.ref,
    briefRef: `${loop.name}/ensemble-judge`,
    instructions: [
      `Two independent implementations exist for issue #${item.ref.number}:`,
      ...prs.map((pr) => `- PR #${pr.ref.number} (branch ${pr.headRef})`),
      '',
      'Judge them against the issue acceptance criteria: correctness, scope',
      'discipline, test quality, and maintainability. Pick exactly ONE winner.',
      '',
      'End your comparison comment with EXACTLY one line:',
      `looper-winner: #<pr-number>`,
      '',
      `looper-run: ${runId}-judge`,
    ].join('\n'),
    expectedBranch: `looper/${loop.name}/${item.ref.number}-${runId}-judge`,
    expectedTrailer: `looper-run: ${runId}-judge`,
    expectation: 'comment' as const,
  };
  const judgeHandle = await gate.dispatch(`ensemble judge via ${judgeBackendId}`, () =>
    judgeBackend.dispatch(judgeBrief),
  );
  if (judgeHandle) {
    await gate.mutate('comment', 'persist judge handle', () =>
      deps.gh.createComment(item.ref, renderDispatchMarker(judgeHandle)).then(() => {}),
    );
    step('dispatch', `judge dispatched to ${judgeBackendId}`);
  }
  return record({ status: 'pending' });
}

async function collectEnsemblePrs(
  deps: RunnerDeps,
  item: IssueSnapshot,
  pendings: PendingDispatch[],
): Promise<PullRequestSnapshot[]> {
  const prs: PullRequestSnapshot[] = [];
  for (const pending of pendings) {
    if (pending.handle.runId.endsWith('-judge')) continue;
    const matches = await deps.gh.listPullRequestsByHeadPrefix(
      { owner: item.ref.owner, repo: item.ref.repo },
      pending.handle.expectedBranch,
      { state: 'all' },
    );
    if (matches[0]) prs.push(matches[0]);
  }
  return prs;
}

async function escalate(
  deps: RunnerDeps,
  item: IssueSnapshot,
  gate: EffectGate,
  reason: string,
): Promise<void> {
  await gate.mutate('label', 'add looper:needs-human', () =>
    deps.gh.addLabels(item.ref, ['looper:needs-human']),
  );
  await gate.comment('ensemble escalation', () =>
    deps.gh.createComment(item.ref, `🚨 looper ensemble: ${reason}`),
  );
  await gate.mutate('claim', 'release', () =>
    releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
  );
}

/** Re-exported for the runner's ingest dispatcher. */
export function isEnsembleLoop(loop: LoopDefinition): boolean {
  return loop.ensemble?.enabled === true;
}

export { findPendingDispatches };
