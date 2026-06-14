import type { GitHubPort, IssueSnapshot, ItemRef } from '@loopdog/core';
import {
  parseCriteriaBlock,
  parseScopeBlock,
  renderCriteriaBlock,
  statusForLabels,
} from '@loopdog/core';
import type { RepoPlanStoreFiles } from '../store/repo-plan-store.js';
import { slugify } from '../store/repo-plan-store.js';
import { STORE_LAYOUT, TASK_TEMPLATE, renderTemplate } from '../format/templates.js';
import {
  parsePlan,
  serializePlan,
  setStatus,
  appendToSection,
  type PlanDoc,
} from '../format/plan-doc.js';

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

const MARKER_RE = /<!-- loopdog:plan task=(\d{4})(?: milestone=\S+)? path=(\S+) -->/;

export function renderPlanMarker(binding: Binding): string {
  return `<!-- loopdog:plan task=${binding.taskId} path=${binding.path} -->`;
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

  // No marker on the issue body. Before minting a NEW plan, look for one already
  // bound to this issue (a prior run created it but the marker write lost a race,
  // or this snapshot predates the marker). Idempotency for concurrent triage:
  // reuse the existing plan instead of allocating a second `nextTaskId()` stub.
  const existing = await findPlanForIssue(files, issue.ref.number);
  const taskId = existing?.taskId ?? (await files.nextTaskId());
  const path = existing?.path ?? (await writeTaskFile(files, taskId, issue));
  const binding: Binding = { issue: issue.ref, taskId, path };

  // Issue → plan marker (idempotent append) so future reads short-circuit.
  if (!issue.body.includes('<!-- loopdog:plan ')) {
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
  const scope = parseScopeBlock(issue.body);
  const content = renderTemplate(TASK_TEMPLATE, {
    id: taskId,
    title: issue.title,
    status: 'planned',
    branch: `loopdog/implement/${issue.ref.number}`,
    issue: `#${issue.ref.number}`,
    goal: issue.title,
    background: firstParagraph(issue.body) || '(from the bound issue)',
    scope: scope ?? '- (groomed scope lands here)',
    criteria:
      criteria && criteria.length > 0
        ? renderCriteriaBlock(criteria)
        : '- [ ] (groomed criteria land here) (manual)',
    testPlan: 'See acceptance criteria `test:` tags.',
  });
  await files.write(path, content, `loopdog: bind issue #${issue.ref.number} to plan ${taskId}`);
  return path;
}

/** Resolve the binding from GitHub state alone (marker, then Issue-field scan). */
export async function resolveBinding(
  files: RepoPlanStoreFiles,
  issue: IssueSnapshot,
): Promise<Binding | null> {
  const marker = parsePlanMarker(issue.body);
  if (marker) return { issue: issue.ref, taskId: marker.taskId, path: marker.path };
  const found = await findPlanForIssue(files, issue.ref.number);
  return found ? { issue: issue.ref, taskId: found.taskId, path: found.path } : null;
}

/**
 * Scan active task files for a plan whose `Issue:` header references this issue
 * number — the marker-free fallback that both resolveBinding and bindIssue use.
 * Matches `#N` exactly so `#2` never collides with `#20`.
 */
async function findPlanForIssue(
  files: RepoPlanStoreFiles,
  number: number,
): Promise<{ taskId: string; path: string } | null> {
  const { docs } = await files.readPlans(files.path(STORE_LAYOUT.tasks));
  for (const doc of docs) {
    if (!issueFieldReferences(doc, number)) continue;
    const file = await files.findTaskFile(doc.id);
    if (file) return { taskId: doc.id, path: file };
  }
  return null;
}

function issueFieldReferences(doc: PlanDoc, number: number): boolean {
  const line = doc.headerLines.find((l) => l.trim().startsWith('Issue:'));
  return line ? new RegExp(`#${number}(?!\\d)`).test(line) : false;
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
    `loopdog: mirror status '${want}' from #${issue.ref.number}`,
    file.sha,
  );
  return { changed: true, status: want };
}

function firstParagraph(body: string): string {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  return stripped.split(/\n\s*\n/)[0]?.trim() ?? '';
}
