import type { ItemRef } from './types.js';

/**
 * The durable-plan-store port (M04): read/write milestones+tasks into the
 * target repo. The plan is the durable memory; GitHub is the control plane;
 * they never disagree (the issue label mirrors the task `Status`).
 */
export interface PlanStore {
  /** Create the task plan for an issue if absent; returns its ref either way. */
  ensureTaskPlan(item: ItemRef, draft: TaskPlanDraft): Promise<PlanRef>;
  /** The plan bound to an issue, or null when none exists yet. */
  findByItem(item: ItemRef): Promise<{ ref: PlanRef; plan: TaskPlan } | null>;
  getPlan(ref: PlanRef): Promise<TaskPlan | null>;
  /** Apply a partial update (sections merge; lists append where noted). */
  updatePlan(ref: PlanRef, patch: TaskPlanPatch): Promise<void>;
  /** Set the plan Status (the issue label mirror reads this). */
  setStatus(ref: PlanRef, status: PlanStatus): Promise<void>;
  appendVerification(ref: PlanRef, entry: string): Promise<void>;
  /** Move a finished/abandoned plan to the archive and update indexes. */
  archive(ref: PlanRef): Promise<void>;
  /** Recompute the plan/milestone indexes from the task files (0018). */
  syncIndexes(): Promise<void>;
}

export interface PlanRef {
  /** Task id, zero-padded (`0042`). */
  id: string;
  /** Repo-relative path of the task file. */
  path: string;
}

/**
 * Plan lifecycle statuses (the protocol this repo itself uses — PLANS.md).
 * Operational hold labels (parked/quarantine/needs-approval) never rewrite
 * plan Status (readiness-review decision, 2026-06-09).
 */
export type PlanStatus =
  | 'planned'
  | 'ready'
  | 'in-progress'
  | 'blocked'
  | 'implemented'
  | 'verified'
  | 'merged'
  | 'abandoned';

export interface TaskPlanDraft {
  title: string;
  goal: string;
  background: string;
  scope: string[];
  outOfScope: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  testPlan: string;
  milestone?: string | undefined;
}

export interface TaskPlan extends TaskPlanDraft {
  id: string;
  status: PlanStatus;
  branch: string;
  checklist: ChecklistEntry[];
  verificationLog: string[];
  decisions: string[];
  risks: string;
  finalSummary: string;
}

export interface TaskPlanPatch {
  goal?: string;
  scope?: string[];
  outOfScope?: string[];
  acceptanceCriteria?: AcceptanceCriterion[];
  checklist?: ChecklistEntry[];
  appendDecisions?: string[];
  risks?: string;
  finalSummary?: string;
  branch?: string;
}

export interface AcceptanceCriterion {
  text: string;
  /** How satisfaction is validated: an executable test path, or manual judgment. */
  validation: { kind: 'test'; ref: string } | { kind: 'manual' };
  met: boolean;
}

export interface ChecklistEntry {
  text: string;
  done: boolean;
}
