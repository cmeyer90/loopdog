import type { GitHubPort, IssueSnapshot, RunRecord } from '@loopdog/core';
import { parseCriteriaBlock, parseScopeBlock, renderCriteriaBlock } from '@loopdog/core';
import type { RepoPlanStoreFiles } from '../store/repo-plan-store.js';
import { STORE_LAYOUT } from '../format/templates.js';
import {
  appendToSection,
  checkItem,
  getSection,
  parsePlan,
  serializePlan,
  setStatus,
  updateSection,
} from '../format/plan-doc.js';
import { bindIssue, resolveBinding, type Binding } from '../binding/binding.js';

/**
 * Plan lifecycle automation (task 0017): the loops — not humans — drive a plan
 * open → update → verify → archive. Every operation is idempotent off the
 * plan's current CONTENT (no external flags), so event↔sweep double-apply
 * yields one effect.
 */

/** Grooming passed DoR → ensure the plan exists with Status: ready. */
export async function openPlan(
  gh: GitHubPort,
  files: RepoPlanStoreFiles,
  issue: IssueSnapshot,
): Promise<Binding> {
  const binding = await bindIssue(gh, files, issue);
  const file = await files.read(binding.path);
  if (!file) return binding; // bindIssue just created it; nothing to upgrade
  const doc = parsePlan(file.content);

  let next = doc;
  if (doc.status === 'planned') next = setStatus(next, 'ready');
  // Carry the groomed criteria + scope from the issue body (loopdog's canonical
  // source) into the durable plan, so the loops that read the PLAN — review,
  // implement — see the same acceptance bar humans groomed on the issue.
  const { criteria } = parseCriteriaBlock(issue.body);
  if (criteria && criteria.length > 0) {
    next = updateSection(next, 'Acceptance Criteria', `\n${renderCriteriaBlock(criteria)}\n`);
  }
  const scope = parseScopeBlock(issue.body);
  if (scope) {
    next = updateSection(next, 'Scope', `\n${scope}\n`);
  }
  if (next !== doc) {
    await files.write(
      binding.path,
      serializePlan(next),
      `loopdog: open plan ${binding.taskId} (DoR ready)`,
      file.sha,
    );
  }
  return binding;
}

/**
 * In-flight progress: append a run_id-keyed Verification Log entry (re-applying
 * the same run appends nothing) and check off named checklist/criteria items.
 */
export async function updatePlan(
  files: RepoPlanStoreFiles,
  binding: Binding,
  record: RunRecord,
  patch: { checklist?: string[]; criteria?: string[]; note?: string } = {},
): Promise<{ changed: boolean }> {
  const file = await files.read(binding.path);
  if (!file) return { changed: false };
  let doc = parsePlan(file.content);

  const logKey = `run \`${record.runId}\``;
  const log = getSection(doc, 'Verification Log') ?? '';
  if (!log.includes(logKey)) {
    const date = record.trigger.at.slice(0, 10);
    const note = patch.note ?? `${record.loop}: ${record.outcome.status}`;
    doc = appendToSection(doc, 'Verification Log', `- ${date}: ${note} (${logKey}).`);
  }
  for (const item of patch.checklist ?? []) {
    doc = checkItem(doc, 'Implementation Checklist', item);
  }
  for (const item of patch.criteria ?? []) {
    doc = checkItem(doc, 'Acceptance Criteria', item);
  }
  const next = serializePlan(doc);
  if (next === file.content) return { changed: false };
  await files.write(binding.path, next, `loopdog: update plan ${binding.taskId}`, file.sha);
  return { changed: true };
}

/** DoD passed → Status: verified, all criteria checked, Final Summary filled. */
export async function verifyPlan(
  files: RepoPlanStoreFiles,
  binding: Binding,
  summary: string,
): Promise<{ changed: boolean }> {
  const file = await files.read(binding.path);
  if (!file) return { changed: false };
  let doc = parsePlan(file.content);
  if (doc.status === 'verified') return { changed: false }; // idempotent

  doc = setStatus(doc, 'verified');
  const criteria = getSection(doc, 'Acceptance Criteria');
  if (criteria) {
    doc = updateSection(doc, 'Acceptance Criteria', criteria.replaceAll('- [ ]', '- [x]'));
  }
  doc = updateSection(doc, 'Final Summary', `\n${summary}\n`);
  await files.write(
    binding.path,
    serializePlan(doc),
    `loopdog: verify plan ${binding.taskId}`,
    file.sha,
  );
  return { changed: true };
}

/** Terminal state → set Status and move the file under archive/. */
export async function archivePlan(
  files: RepoPlanStoreFiles,
  binding: Binding,
  terminal: 'merged' | 'abandoned',
): Promise<{ changed: boolean; archivedPath?: string }> {
  if (binding.path.includes('/archive/')) return { changed: false }; // already archived
  const file = await files.read(binding.path);
  if (!file) return { changed: false };
  let doc = parsePlan(file.content);
  doc = setStatus(doc, terminal);

  const name = binding.path.split('/').pop()!;
  const archivedPath = files.path(STORE_LAYOUT.archiveTasks, name);
  await files.write(archivedPath, serializePlan(doc), `loopdog: archive plan ${binding.taskId}`);
  // Tombstone in place of the active file so the binding marker still resolves.
  await files.write(
    binding.path,
    `# ${binding.taskId} (archived)\n\n<!-- loopdog:tombstone -->\nStatus: ${terminal}\n\nMoved to ${archivedPath}.\n`,
    `loopdog: tombstone for archived plan ${binding.taskId}`,
    file.sha,
  );
  return { changed: true, archivedPath };
}

export { bindIssue, resolveBinding };
