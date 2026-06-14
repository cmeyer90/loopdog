import type { GitHubPort, IssueSnapshot, RunRecord } from '@loopdog/core';
import {
  archivePlan,
  openPlan,
  reconcileBinding,
  resolveBinding,
  updatePlan,
  verifyPlan,
} from '@loopdog/plans';
import type { RepoPlanStoreFiles } from '@loopdog/plans';
import type { EffectGate } from './effect-gate.js';
import { linkedIssue } from './loop-actions.js';

/**
 * Plan lifecycle wiring (task 0017): the runner's write-back calls the right
 * lifecycle operation for the transition applied, then mirrors label<->Status
 * (0016). All writes flow through the mode EffectGate. Optional: a runner
 * without a plan store configured simply skips plan upkeep.
 *
 * The plan is always bound to the SOURCE ISSUE, never the PR (task 0097): a
 * pull-request item (review, merge) resolves back to the issue it implements so
 * those loops update the one durable plan instead of minting a PR-numbered one.
 */
export async function syncPlanAfterTransition(
  gh: GitHubPort,
  files: RepoPlanStoreFiles | undefined,
  gate: EffectGate,
  item: IssueSnapshot,
  to: string,
  record: RunRecord,
  now: Date,
): Promise<void> {
  if (!files) return;
  await gate.mutate('plan', `lifecycle for -> ${to}`, async () => {
    const live = await planIssueFor(gh, item);
    if (!live) return; // a PR with no linked source issue → nothing to keep
    if (to === 'ready-for-agent') {
      await openPlan(gh, files, live);
      return;
    }
    const binding = (await resolveBinding(files, live)) ?? (await openPlan(gh, files, live));
    if (to === 'verified') {
      await verifyPlan(
        files,
        binding,
        `Verified by loopdog run \`${record.runId}\` (${record.loop}).`,
      );
    } else if (to === 'merged' || to === 'abandoned') {
      await archivePlan(files, binding, to);
    } else {
      await updatePlan(files, binding, record, {
        note: `${record.loop}: ${to}`,
      });
    }
    await reconcileBinding(files, await gh.getIssue(item.ref), binding, now);
  });
}

/**
 * The issue a plan should be bound to for this item: the item itself when it is
 * an issue; the PR's linked source issue when it is a pull-request. Returns null
 * for a PR that references no issue — the caller skips plan upkeep rather than
 * mint a plan bound to the PR number.
 */
async function planIssueFor(gh: GitHubPort, item: IssueSnapshot): Promise<IssueSnapshot | null> {
  if (item.kind === 'pull-request') {
    const pr = await gh.getPullRequest(item.ref);
    return linkedIssue(gh, pr);
  }
  return gh.getIssue(item.ref);
}
