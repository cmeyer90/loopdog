import type { LabelSpec } from '../ports/types.js';
import type { TransitionTable } from './transition-table.js';
import { OFF_RAMP_LABELS, OPERATIONAL_LABELS, stateLabel } from './states.js';

/**
 * Pure label-reconciliation planner (task 0011): given the labels a repo
 * already has and the table in force, compute which loopdog labels to create.
 * Never plans modification or deletion of labels loopdog didn't create —
 * "create missing, never clobber custom". IO application lives in
 * `@loopdog/github`.
 */
export function planLabelReconciliation(
  existing: readonly LabelSpec[],
  table: TransitionTable,
): { create: LabelSpec[] } {
  const have = new Set(existing.map((l) => l.name));
  const want: LabelSpec[] = [
    ...table.states.map((s) => ({
      name: stateLabel(s),
      color: STATE_COLOR,
      description: `loopdog lifecycle state: ${s}`,
    })),
    ...OFF_RAMP_LABELS.map((name) => ({
      name,
      color: OFF_RAMP_COLOR,
      description: 'loopdog off-ramp (terminal/holding)',
    })),
    ...OPERATIONAL_LABELS.map((name) => ({
      name,
      color: OPERATIONAL_COLOR,
      description: 'loopdog operational marker',
    })),
  ];
  return { create: want.filter((l) => !have.has(l.name)) };
}

const STATE_COLOR = '1d76db';
const OFF_RAMP_COLOR = 'b60205';
const OPERATIONAL_COLOR = 'fbca04';
