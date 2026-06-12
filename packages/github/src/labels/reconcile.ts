import type { GitHubPort, RepoRef, TransitionTable } from '@looper/core';
import { planLabelReconciliation } from '@looper/core';

/**
 * Apply the label plan to a repo (task 0011): create missing looper labels,
 * never touch labels looper didn't create. Idempotent — a second run creates
 * nothing.
 */
export async function reconcileLabels(
  gh: GitHubPort,
  repo: RepoRef,
  table: TransitionTable,
): Promise<{ created: string[] }> {
  const existing = await gh.listRepoLabels(repo);
  const plan = planLabelReconciliation(existing, table);
  const created: string[] = [];
  for (const label of plan.create) {
    await gh.createRepoLabel(repo, label);
    created.push(label.name);
  }
  return { created };
}
