import type { GitHubPort, IssueSnapshot, ItemRef } from '@looper/core';
import { parseCriteriaBlock, renderCriteriaBlock, statusForLabels } from '@looper/core';
import type { RepoPlanStoreFiles } from '../store/repo-plan-store.js';
import { slugify } from '../store/repo-plan-store.js';
import { STORE_LAYOUT, TASK_TEMPLATE, renderTemplate } from '../format/templates.js';
import { parsePlan, serializePlan, setStatus, appendToSection } from '../format/plan-doc.js';

/**
 * Issue ↔ plan binding (task 0016): every issue gets a durable plan; either
 * side resolves the other; the issue label and plan Status never disagree
 * (label authoritative on drift — GitHub is the control plane).
 */

export interface Binding {
  issue: ItemRef;
  taskId: string;
  path: string;
}

const MARKER_RE = /<!-- looper:plan task=(\d{4})(?: milestone=\S+)? path=(\S+) -->/;

export function renderPlanMarker(binding: Binding): string {
  return `<!-- looper:plan task=${binding.taskId} path=${binding.path} -->`;
}

export function parsePlanMarker(issueBody: string): { taskId: string; path: string } | null {
  const m = issueBody.match(MARKER_RE);
  return m ? { taskId: m[1]!, path: m[2]! } : null;
}

/** Bind an issue to a plan, creating the task file once (idempotent). */
export async function bindIssue(
  gh: GitHubPort,
  files: RepoPlanStoreFiles,
  issue: IssueSnapshot,
): Promise<Binding> {
  // Already bound (marker + file exist)? Short-circuit.
  const marker = parsePlanMarker(issue.body);
  if (marker && (await files.read(marker.path))) {
    return { issue: issue.ref, taskId: marker.taskId, path: marker.path };
  }
  if (marker) {
    // Marker present but plan file deleted → regenerate at the same id.
    const regenerated = await writeTaskFile(files, marker.taskId, issue);
    return { issue: issue.ref, taskId: marker.taskId, path: regenerated };
  }

  const taskId = await files.nextTaskId();
  const path = await writeTaskFile(files, taskId, issue);
  const binding: Binding = { issue: issue.ref, taskId, path };

  // Issue → plan marker (idempotent append).
  if (!issue.body.includes('<!-- looper:plan ')) {
    await gh.updateIssueBody(
      issue.ref,
      issue.body.trimEnd() + `\n\n${renderPlanMarker(binding)}\n`,
    );
  }
  return binding;
}

async function writeTaskFile(
  files: RepoPlanStoreFiles,
  taskId: string,
  issue: IssueSnapshot,
): Promise<string> {
  const slug = slugify(issue.title);
  const path = files.path(STORE_LAYOUT.tasks, `${taskId}-${slug}.md`);
  const { criteria } = parseCriteriaBlock(issue.body);
  const content = renderTemplate(TASK_TEMPLATE, {
    id: taskId,
    title: issue.title,
    status: 'planned',
    branch: `looper/implement/${issue.ref.number}`,
    issue: `#${issue.ref.number}`,
    goal: issue.title,
    background: firstParagraph(issue.body) || '(from the bound issue)',
    scope: '- (groomed scope lands here)',
    criteria:
      criteria && criteria.length > 0
        ? renderCriteriaBlock(criteria)
        : '- [ ] (groomed criteria land here) (manual)',
    testPlan: 'See acceptance criteria `test:` tags.',
  });
  await files.write(path, content, `looper: bind issue #${issue.ref.number} to plan ${taskId}`);
  return path;
}

/** Resolve the binding from GitHub state alone (marker, then slug scan). */
export async function resolveBinding(
  files: RepoPlanStoreFiles,
  issue: IssueSnapshot,
): Promise<Binding | null> {
  const marker = parsePlanMarker(issue.body);
  if (marker) return { issue: issue.ref, taskId: marker.taskId, path: marker.path };
  // Fallback scan: a task whose Issue: field references this number.
  const { docs } = await files.readPlans(files.path(STORE_LAYOUT.tasks));
  for (const doc of docs) {
    if (
      doc.headerLines.some(
        (l) => l.trim().startsWith('Issue:') && l.includes(`#${issue.ref.number}`),
      )
    ) {
      const file = await files.findTaskFile(doc.id);
      if (file) return { issue: issue.ref, taskId: doc.id, path: file };
    }
  }
  return null;
}

/**
 * Repair label↔Status drift: the live LABEL wins; the plan is rewritten and
 * the change logged in its Verification Log. No-op when they already agree.
 */
export async function reconcileBinding(
  files: RepoPlanStoreFiles,
  issue: IssueSnapshot,
  binding: Binding,
  now: Date,
): Promise<{ changed: boolean; status?: string }> {
  const want = statusForLabels(issue.labels);
  if (!want) return { changed: false };
  const file = await files.read(binding.path);
  if (!file) return { changed: false };
  const doc = parsePlan(file.content);
  if (doc.status === want) return { changed: false };

  let next = setStatus(doc, want);
  next = appendToSection(
    next,
    'Verification Log',
    `- ${now.toISOString().slice(0, 10)}: status ${doc.status} -> ${want} ` +
      `(mirrored from issue label; label is authoritative).`,
  );
  await files.write(
    binding.path,
    serializePlan(next),
    `looper: mirror status '${want}' from #${issue.ref.number}`,
    file.sha,
  );
  return { changed: true, status: want };
}

function firstParagraph(body: string): string {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  return stripped.split(/\n\s*\n/)[0]?.trim() ?? '';
}
