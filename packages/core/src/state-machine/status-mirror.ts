import type { PlanStatus } from '../ports/plan-store.js';
import { STATE_LABEL_PREFIX } from './states.js';

/**
 * The single label ↔ plan-Status mapping (task 0016): the only place the
 * mirror lives, so the durable plan and the GitHub label cannot drift by
 * design. Operational hold labels (needs-approval/approved/parked/stop,
 * claims) are orthogonal and never rewrite plan Status. On drift the LABEL is
 * authoritative (GitHub is the control plane).
 */

const STATE_TO_STATUS: Record<string, PlanStatus> = {
  new: 'planned',
  'needs-grooming': 'planned',
  'needs-clarification': 'planned',
  'ready-for-agent': 'ready',
  'in-progress': 'in-progress',
  'in-review': 'implemented',
  'changes-requested': 'implemented',
  verified: 'verified',
  merged: 'merged',
  // deploy sub-states are deployment, not plan progress (0016 decision)
  deploying: 'merged',
  deployed: 'merged',
  'deploy-failed': 'merged',
  'rolled-back': 'merged',
  scheduled: 'ready',
};

const OFF_RAMP_TO_STATUS: Record<string, PlanStatus> = {
  'loopdog:blocked': 'blocked',
  'loopdog:needs-human': 'blocked',
  'loopdog:stuck': 'blocked',
  'loopdog:quarantine': 'blocked',
  'loopdog:abandoned': 'abandoned',
};

/** Plan Status for a lifecycle/off-ramp label; null for labels that never map. */
export function statusForLabel(label: string): PlanStatus | null {
  if (label.startsWith(STATE_LABEL_PREFIX)) {
    return STATE_TO_STATUS[label.slice(STATE_LABEL_PREFIX.length)] ?? null;
  }
  return OFF_RAMP_TO_STATUS[label] ?? null;
}

/**
 * The Status the item's labels imply: an off-ramp wins over the lifecycle
 * state (a blocked item is blocked whatever state it sits in).
 */
export function statusForLabels(labels: readonly string[]): PlanStatus | null {
  for (const label of labels) {
    const offRamp = OFF_RAMP_TO_STATUS[label];
    if (offRamp) return offRamp;
  }
  for (const label of labels) {
    const status = statusForLabel(label);
    if (status) return status;
  }
  return null;
}

/** Every label that maps to the given Status (total over the enum). */
export function labelsForStatus(status: PlanStatus): string[] {
  const labels: string[] = [];
  for (const [state, s] of Object.entries(STATE_TO_STATUS)) {
    if (s === status) labels.push(`${STATE_LABEL_PREFIX}${state}`);
  }
  for (const [label, s] of Object.entries(OFF_RAMP_TO_STATUS)) {
    if (s === status) labels.push(label);
  }
  return labels;
}
