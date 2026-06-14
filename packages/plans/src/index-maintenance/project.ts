import type { PlanDoc } from '../format/plan-doc.js';
import { getHeaderField } from '../format/plan-doc.js';
import type { RepoPlanStoreFiles } from '../store/repo-plan-store.js';
import { STORE_LAYOUT } from '../format/templates.js';

/**
 * Plan index maintenance (task 0018): the index files are a deterministic
 * PROJECTION of the plan files — a view, never a second source of truth. The
 * sweep's full rebuild is authoritative; writes are render-then-compare so
 * re-projection of unchanged input is a no-op.
 */

export interface ProjectedIndexes {
  planIndex: string;
  milestonesIndex: string;
  skipped: string[];
}

/** Pure projection: parsed plans → rendered index files. */
export function projectIndexes(
  active: PlanDoc[],
  archived: PlanDoc[],
  skipped: string[] = [],
): ProjectedIndexes {
  const tasks = active.filter((d) => d.kind === 'task').sort((a, b) => a.id.localeCompare(b.id));
  const archivedTasks = archived
    .filter((d) => d.kind === 'task')
    .sort((a, b) => a.id.localeCompare(b.id));
  const milestones = active
    .filter((d) => d.kind === 'milestone')
    .sort((a, b) => a.id.localeCompare(b.id));

  const maxId = Math.max(0, ...[...tasks, ...archivedTasks].map((d) => Number(d.id) || 0));
  const nextId = String(maxId + 1).padStart(4, '0');

  const planIndex = [
    '# Task Index',
    '',
    'Derived from the task files by loopdog — do not edit by hand.',
    '',
    `- **Next task id:** \`${nextId}\``,
    `- **Total tasks:** ${tasks.length}`,
    '',
    '| ID | Status | Branch | Title |',
    '|---:|---|---|---|',
    ...tasks.map(
      (d) => `| ${d.id} | ${d.status} | ${getHeaderField(d, 'Branch') ?? '-'} | ${d.title} |`,
    ),
    '',
  ].join('\n');

  const milestonesIndex = [
    '# Milestones',
    '',
    'Derived from the milestone files by loopdog — do not edit by hand.',
    '',
    '| Milestone | Status | Title |',
    '|---:|---|---|',
    ...milestones.map((d) => `| ${d.id} | ${d.status} | ${d.title} |`),
    '',
  ].join('\n');

  return { planIndex, milestonesIndex, skipped };
}

/**
 * Authoritative full rebuild (the sweep's backstop): re-derive both indexes
 * from every plan file; write only when bytes differ.
 */
export async function rebuildIndexes(files: RepoPlanStoreFiles): Promise<{
  wrote: string[];
  skipped: string[];
}> {
  const active = await files.readPlans(files.path(STORE_LAYOUT.tasks));
  const activeMilestones = await files.readPlans(files.path(STORE_LAYOUT.milestones));
  const archived = await files.readPlans(files.path(STORE_LAYOUT.archiveTasks));

  const projected = projectIndexes([...active.docs, ...activeMilestones.docs], archived.docs, [
    ...active.skipped,
    ...activeMilestones.skipped,
    ...archived.skipped,
  ]);

  const wrote: string[] = [];
  const targets: Array<[string, string]> = [
    [files.path(STORE_LAYOUT.planIndex), projected.planIndex],
    [files.path(STORE_LAYOUT.milestonesIndex), projected.milestonesIndex],
  ];
  if (archived.docs.length > 0) {
    const archiveIndex = projectIndexes(archived.docs, []).planIndex.replace(
      '# Task Index',
      '# Archived Task Index',
    );
    targets.push([files.path(STORE_LAYOUT.archivePlanIndex), archiveIndex]);
  }
  for (const [path, content] of targets) {
    const existing = await files.read(path);
    if (existing?.content === content) continue;
    await files.write(path, content, 'loopdog: rebuild plan indexes');
    wrote.push(path);
  }
  return { wrote, skipped: projected.skipped };
}

/** Incremental fast path after one plan changed — V1 delegates to the rebuild
 * (the store is small and the rebuild is already minimal-diff/no-op-safe). */
export async function updateIndexesFor(
  _taskId: string,
  files: RepoPlanStoreFiles,
): Promise<{ wrote: string[] }> {
  const { wrote } = await rebuildIndexes(files);
  return { wrote };
}
