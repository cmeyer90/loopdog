import { DEFAULT_STATES, DEPLOY_STATES, OFF_RAMP_STATES } from './states.js';

/**
 * The legal-transition table (task 0011). Each edge is one transition a loop
 * may drive. Custom loops may declare new states and edges; the engine
 * validates every loop's `transition: { from, to }` against the merged table
 * and rejects illegal ones at config-validate time.
 */
export interface TransitionEdge {
  from: string;
  to: string;
  /** The loop family that owns this edge (documentation; not enforced per-loop). */
  by: string;
}

export interface TransitionTable {
  states: string[];
  edges: TransitionEdge[];
}

export const DEFAULT_TRANSITION_TABLE: TransitionTable = {
  states: [...DEFAULT_STATES, ...DEPLOY_STATES],
  edges: [
    { from: 'new', to: 'needs-grooming', by: 'groom' },
    { from: 'needs-grooming', to: 'needs-clarification', by: 'groom' },
    { from: 'needs-clarification', to: 'ready-for-agent', by: 'groom' },
    { from: 'needs-grooming', to: 'ready-for-agent', by: 'groom' },
    { from: 'ready-for-agent', to: 'in-progress', by: 'implement' },
    { from: 'in-progress', to: 'in-review', by: 'implement' },
    { from: 'in-review', to: 'changes-requested', by: 'review' },
    { from: 'changes-requested', to: 'in-progress', by: 'fix' },
    { from: 'in-review', to: 'verified', by: 'review' },
    { from: 'verified', to: 'merged', by: 'merge' },
    { from: 'merged', to: 'deploying', by: 'deploy' },
    { from: 'deploying', to: 'deployed', by: 'deploy-smoke' },
    { from: 'deploying', to: 'deploy-failed', by: 'deploy-smoke' },
    { from: 'deploy-failed', to: 'rolled-back', by: 'rollback' },
  ],
};

export interface EdgeValidation {
  legal: boolean;
  reason?: string | undefined;
}

/**
 * Is `from → to` a legal edge? Off-ramps (`needs-human`, `blocked`, `stuck`,
 * `abandoned`) are implicitly legal from any state (0011 decision).
 */
export function validateEdge(table: TransitionTable, from: string, to: string): EdgeValidation {
  if (OFF_RAMP_STATES.includes(to)) return { legal: true };
  if (!table.states.includes(from)) {
    return { legal: false, reason: `unknown 'from' state '${from}' (declare it before use)` };
  }
  if (!table.states.includes(to)) {
    return { legal: false, reason: `unknown 'to' state '${to}' (declare it before use)` };
  }
  const found = table.edges.some((e) => e.from === from && e.to === to);
  return found
    ? { legal: true }
    : { legal: false, reason: `no legal edge '${from} -> ${to}' in the transition table` };
}

/**
 * Validate a LOOP's declared transition. A deterministic loop needs a direct
 * edge. A work-cell loop (it dispatches and later ingests) may also span the
 * canonical two-edge path through the dispatched state:
 * `from -> in-progress -> to` (e.g. implement: ready-for-agent -> in-review).
 */
export function validateLoopTransition(
  table: TransitionTable,
  transition: { from: string; to: string },
  opts: { dispatches: boolean },
): EdgeValidation {
  const direct = validateEdge(table, transition.from, transition.to);
  if (direct.legal) return direct;
  if (opts.dispatches && transition.from !== 'in-progress' && transition.to !== 'in-progress') {
    const enter = validateEdge(table, transition.from, 'in-progress');
    const exit = validateEdge(table, 'in-progress', transition.to);
    if (enter.legal && exit.legal) return { legal: true };
  }
  return direct;
}

/** Merge custom states/edges into a table (custom loops, 0078). */
export function extendTable(
  table: TransitionTable,
  extension: { states?: string[]; edges?: TransitionEdge[] },
): TransitionTable {
  const states = [...table.states];
  for (const s of extension.states ?? []) {
    if (!states.includes(s)) states.push(s);
  }
  const edges = [...table.edges];
  for (const e of extension.edges ?? []) {
    if (!edges.some((x) => x.from === e.from && x.to === e.to)) edges.push(e);
  }
  return { states, edges };
}
