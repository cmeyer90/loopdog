import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSITION_TABLE,
  extendTable,
  planLabelReconciliation,
  stateLabel,
  stateOfLabels,
  validateEdge,
} from '@loopdog/core';

describe('transition table (0011)', () => {
  it('accepts every default edge', () => {
    for (const e of DEFAULT_TRANSITION_TABLE.edges) {
      expect(validateEdge(DEFAULT_TRANSITION_TABLE, e.from, e.to).legal).toBe(true);
    }
  });

  it('rejects an undeclared edge with a reason', () => {
    const v = validateEdge(DEFAULT_TRANSITION_TABLE, 'new', 'merged');
    expect(v.legal).toBe(false);
    expect(v.reason).toContain("no legal edge 'new -> merged'");
  });

  it('rejects unknown states by name', () => {
    expect(validateEdge(DEFAULT_TRANSITION_TABLE, 'nonexistent', 'merged').reason).toContain(
      "unknown 'from' state",
    );
    expect(validateEdge(DEFAULT_TRANSITION_TABLE, 'new', 'nonexistent').reason).toContain(
      "unknown 'to' state",
    );
  });

  it('treats off-ramps as implicitly legal from any state', () => {
    for (const target of ['needs-human', 'blocked', 'stuck', 'abandoned']) {
      expect(validateEdge(DEFAULT_TRANSITION_TABLE, 'in-progress', target).legal).toBe(true);
    }
  });

  it('extends with custom states + edges without mutating the default', () => {
    const extended = extendTable(DEFAULT_TRANSITION_TABLE, {
      states: ['security-review'],
      edges: [{ from: 'in-review', to: 'security-review', by: 'security' }],
    });
    expect(validateEdge(extended, 'in-review', 'security-review').legal).toBe(true);
    expect(validateEdge(DEFAULT_TRANSITION_TABLE, 'in-review', 'security-review').legal).toBe(
      false,
    );
    // re-extending is idempotent
    const again = extendTable(extended, {
      states: ['security-review'],
      edges: [{ from: 'in-review', to: 'security-review', by: 'security' }],
    });
    expect(again.states.filter((s) => s === 'security-review')).toHaveLength(1);
    expect(again.edges.filter((e) => e.to === 'security-review')).toHaveLength(1);
  });
});

describe('label reconciliation planner (0011)', () => {
  it('creates all loopdog labels on an empty repo and is idempotent', () => {
    const first = planLabelReconciliation([], DEFAULT_TRANSITION_TABLE);
    expect(first.create.length).toBeGreaterThan(0);
    expect(first.create.map((l) => l.name)).toContain('loopdog:state/new');
    expect(first.create.map((l) => l.name)).toContain('loopdog:needs-human');
    // second run with the created labels present plans nothing
    const second = planLabelReconciliation(first.create, DEFAULT_TRANSITION_TABLE);
    expect(second.create).toEqual([]);
  });

  it('never plans changes to labels it does not own', () => {
    const plan = planLabelReconciliation(
      [{ name: 'bug' }, { name: 'loopdog:state/new', color: 'ffffff' }],
      DEFAULT_TRANSITION_TABLE,
    );
    // existing loopdog label (even with a custom color) is left alone; 'bug' untouched
    expect(plan.create.map((l) => l.name)).not.toContain('loopdog:state/new');
    expect(plan.create.map((l) => l.name)).not.toContain('bug');
  });
});

describe('state labels', () => {
  it('round-trips state <-> label', () => {
    expect(stateLabel('in-review')).toBe('loopdog:state/in-review');
    expect(stateOfLabels(['bug', 'loopdog:state/in-review'])).toBe('in-review');
    expect(stateOfLabels(['bug'])).toBeNull();
  });
});
