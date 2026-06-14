import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSITION_TABLE,
  claimLabel,
  decideTransition,
  deriveRunId,
  idempotencyKey,
  leaseExpiry,
  leaseLabel,
  standardChecks,
  stateLabel,
} from '@loopdog/core';
import type { IssueSnapshot, LoopDefinition } from '@loopdog/core';

const NOW = new Date('2026-06-09T12:00:00Z');

const implementLoop: LoopDefinition = {
  name: 'implement',
  trigger: { kind: 'github_event', events: ['issues.labeled'] },
  transition: { from: 'ready-for-agent', to: 'in-progress' },
  backend: 'claude',
  gates: { requireDor: true, requireCi: true, tier: 'default' },
  promptPath: '.loopdog/loops/implement/prompt.md',
  mode: 'act',
};

function item(labels: string[]): IssueSnapshot {
  return {
    ref: { owner: 'o', repo: 'r', number: 7 },
    kind: 'issue',
    title: 'Add rate limiting',
    body: 'body',
    state: 'open',
    labels,
    assignees: [],
    author: { login: 'dana', type: 'User' },
    authorAssociation: 'COLLABORATOR',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-09T00:00:00Z',
  };
}

describe('transition decision (0012)', () => {
  it('proceeds for an eligible item', () => {
    const checks = standardChecks(
      implementLoop,
      DEFAULT_TRANSITION_TABLE,
      item([stateLabel('ready-for-agent')]),
      NOW,
    );
    expect(decideTransition(checks).verdict).toEqual({ kind: 'proceed' });
  });

  it('no-ops when the target state is already reached (idempotent re-run)', () => {
    const d = decideTransition(
      standardChecks(
        implementLoop,
        DEFAULT_TRANSITION_TABLE,
        item([stateLabel('in-progress')]),
        NOW,
      ),
    );
    expect(d.verdict.kind).toBe('no-op');
    expect(d.decidedBy).toBe('already-advanced');
  });

  it('skips items in a different state', () => {
    const d = decideTransition(
      standardChecks(implementLoop, DEFAULT_TRANSITION_TABLE, item([stateLabel('new')]), NOW),
    );
    expect(d.verdict.kind).toBe('skip');
  });

  it('escalates on an illegal loop edge instead of running it', () => {
    const badLoop = { ...implementLoop, transition: { from: 'new', to: 'merged' } };
    const d = decideTransition(
      standardChecks(badLoop, DEFAULT_TRANSITION_TABLE, item([stateLabel('new')]), NOW),
    );
    expect(d.verdict.kind).toBe('escalate');
    expect(d.decidedBy).toBe('edge-legal');
  });

  it('skips on operational holds and off-ramps', () => {
    for (const hold of [
      'loopdog:stop',
      'loopdog:parked',
      'loopdog:needs-approval',
      'loopdog:quarantine',
      'loopdog:needs-human',
    ]) {
      const d = decideTransition(
        standardChecks(
          implementLoop,
          DEFAULT_TRANSITION_TABLE,
          item([stateLabel('ready-for-agent'), hold]),
          NOW,
        ),
      );
      expect(d.verdict.kind, hold).toBe('skip');
    }
  });

  it('skips while a live claim is in flight, proceeds once the lease expires', () => {
    const liveLease = leaseLabel(leaseExpiry(NOW, 30));
    const live = decideTransition(
      standardChecks(
        implementLoop,
        DEFAULT_TRANSITION_TABLE,
        item([stateLabel('ready-for-agent'), claimLabel('run-x'), liveLease]),
        NOW,
      ),
    );
    expect(live.verdict.kind).toBe('skip');
    expect(live.decidedBy).toBe('claim-in-flight');

    const expiredLease = leaseLabel('2026-06-09T11:00:00.000Z');
    const expired = decideTransition(
      standardChecks(
        implementLoop,
        DEFAULT_TRANSITION_TABLE,
        item([stateLabel('ready-for-agent'), claimLabel('run-x'), expiredLease]),
        NOW,
      ),
    );
    expect(expired.verdict).toEqual({ kind: 'proceed' });
  });
});

describe('run identity (0012)', () => {
  it('derives stable, distinct run ids and idempotency keys', () => {
    const ref = { owner: 'o', repo: 'r', number: 7 };
    expect(deriveRunId('implement', ref, 1)).toBe(deriveRunId('implement', ref, 1));
    expect(deriveRunId('implement', ref, 1)).not.toBe(deriveRunId('implement', ref, 2));
    expect(idempotencyKey('implement', ref, 'ready-for-agent')).toBe(
      'implement:o/r#7:ready-for-agent',
    );
  });
});
