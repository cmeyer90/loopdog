import type {
  GitHubPort,
  ItemRef,
  PlanRef,
  PlanStatus,
  PlanStore,
  RepoRef,
  TaskPlan,
  TaskPlanDraft,
  TaskPlanPatch,
} from '@loopdog/core';
import { parseCriteriaBlock } from '@loopdog/core';
import { RepoPlanStoreFiles } from './repo-plan-store.js';
import {
  appendToSection,
  getHeaderField,
  getSection,
  parsePlan,
  serializePlan,
  setStatus,
  updateSection,
} from '../format/plan-doc.js';
import { bindIssue, resolveBinding } from '../binding/binding.js';
import { archivePlan } from '../lifecycle/lifecycle.js';
import { rebuildIndexes } from '../index-maintenance/project.js';

/**
 * The production `PlanStore` (core port, 0094) backed by markdown plans in the
 * target repo (tasks 0015-0018). Thin facade over the format/binding/lifecycle
 * modules so runtime consumers code against the port only.
 */
export class RepoPlanStore implements PlanStore {
  private readonly files: RepoPlanStoreFiles;

  constructor(
    private readonly gh: GitHubPort,
    repo: RepoRef,
    branch: string,
    root: string,
  ) {
    this.files = new RepoPlanStoreFiles(gh, repo, branch, root);
  }

  /** Access to the underlying file primitives (lifecycle/index modules). */
  get storeFiles(): RepoPlanStoreFiles {
    return this.files;
  }

  async ensureTaskPlan(item: ItemRef, _draft: TaskPlanDraft): Promise<PlanRef> {
    const issue = await this.gh.getIssue(item);
    const binding = await bindIssue(this.gh, this.files, issue);
    return { id: binding.taskId, path: binding.path };
  }

  async findByItem(item: ItemRef): Promise<{ ref: PlanRef; plan: TaskPlan } | null> {
    const issue = await this.gh.getIssue(item);
    const binding = await resolveBinding(this.files, issue);
    if (!binding) return null;
    const plan = await this.getPlan({ id: binding.taskId, path: binding.path });
    return plan ? { ref: { id: binding.taskId, path: binding.path }, plan } : null;
  }

  async getPlan(ref: PlanRef): Promise<TaskPlan | null> {
    const file = await this.files.read(ref.path);
    if (!file) return null;
    const doc = parsePlan(file.content);
    const criteriaBody = getSection(doc, 'Acceptance Criteria') ?? '';
    const { criteria } = parseCriteriaBlock(criteriaBody);
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status as PlanStatus,
      branch: getHeaderField(doc, 'Branch') ?? '',
      goal: (getSection(doc, 'Goal') ?? '').trim(),
      background: (getSection(doc, 'Background') ?? '').trim(),
      scope: listItems(getSection(doc, 'Scope')),
      outOfScope: listItems(getSection(doc, 'Out Of Scope')),
      acceptanceCriteria: criteria ?? [],
      testPlan: (getSection(doc, 'Test Plan') ?? '').trim(),
      checklist: (getSection(doc, 'Implementation Checklist') ?? '')
        .split('\n')
        .filter((l) => /^- \[[ x]\]/.test(l.trim()))
        .map((l) => ({ text: l.replace(/^\s*- \[[ x]\]\s*/, ''), done: l.includes('[x]') })),
      verificationLog: listItems(getSection(doc, 'Verification Log')),
      decisions: listItems(getSection(doc, 'Decisions')),
      risks: (getSection(doc, 'Risks / Rollback') ?? '').trim(),
      finalSummary: (getSection(doc, 'Final Summary') ?? '').trim(),
    };
  }

  async updatePlan(ref: PlanRef, patch: TaskPlanPatch): Promise<void> {
    const file = await this.files.read(ref.path);
    if (!file) return;
    let doc = parsePlan(file.content);
    if (patch.goal !== undefined) doc = updateSection(doc, 'Goal', `\n${patch.goal}\n`);
    if (patch.scope !== undefined)
      doc = updateSection(doc, 'Scope', `\n${patch.scope.map((s) => `- ${s}`).join('\n')}\n`);
    if (patch.outOfScope !== undefined)
      doc = updateSection(
        doc,
        'Out Of Scope',
        `\n${patch.outOfScope.map((s) => `- ${s}`).join('\n')}\n`,
      );
    if (patch.finalSummary !== undefined)
      doc = updateSection(doc, 'Final Summary', `\n${patch.finalSummary}\n`);
    for (const decision of patch.appendDecisions ?? []) {
      doc = appendToSection(doc, 'Decisions', `- ${decision}`);
    }
    const next = serializePlan(doc);
    if (next !== file.content) {
      await this.files.write(ref.path, next, `loopdog: update plan ${ref.id}`, file.sha);
    }
  }

  async setStatus(ref: PlanRef, status: PlanStatus): Promise<void> {
    const file = await this.files.read(ref.path);
    if (!file) return;
    const doc = parsePlan(file.content);
    if (doc.status === status) return;
    await this.files.write(
      ref.path,
      serializePlan(setStatus(doc, status)),
      `loopdog: plan ${ref.id} status -> ${status}`,
      file.sha,
    );
  }

  async appendVerification(ref: PlanRef, entry: string): Promise<void> {
    const file = await this.files.read(ref.path);
    if (!file) return;
    const doc = appendToSection(parsePlan(file.content), 'Verification Log', `- ${entry}`);
    await this.files.write(
      ref.path,
      serializePlan(doc),
      `loopdog: log on plan ${ref.id}`,
      file.sha,
    );
  }

  async archive(ref: PlanRef): Promise<void> {
    await archivePlan(
      this.files,
      { issue: { owner: '', repo: '', number: 0 }, taskId: ref.id, path: ref.path },
      'merged',
    );
    await rebuildIndexes(this.files);
  }

  async syncIndexes(): Promise<void> {
    await rebuildIndexes(this.files);
  }
}

function listItems(body: string | null): string[] {
  if (!body) return [];
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
}
