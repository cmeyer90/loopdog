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

/**
 * Plan lifecycle wiring (task 0017): the runner's write-back calls the right
 * lifecycle operation for the transition applied, then mirrors label<->Status
 * (0016). All writes flow through the mode EffectGate. Optional: a runner
 * without a plan store configured simply skips plan upkeep.
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
    const live = await gh.getIssue(item.ref);
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
