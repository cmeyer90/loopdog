import { describe, expect, it } from 'vitest';
import {
  FakeBackend,
  ReplayBackend,
  claudeLike,
  codexLike,
  runBackendConformance,
  selfHostedLike,
  type Cassette,
} from '@loopdog/testing';

/**
 * Backend conformance (task 0084): the scripted fake and the replay backend
 * BOTH satisfy the dispatch→ingest contract (0012/0073) — zero quota, no
 * network. The real backends run the same suite under tier 5 (operator-gated).
 */

runBackendConformance({
  name: 'FakeBackend (scripted, open-pr)',
  makeBackend: (gh) => new FakeBackend(gh, { id: 'claude' }),
});

const cassette: Cassette = {
  capabilities: claudeLike(),
  exchanges: {
    implement: {
      signal: { kind: 'claude-session', sessionId: 'replay-impl' },
      pr: { number: 9001, headRef: '{branch}', body: 'Implements {issue}.\n\n{trailer}' },
    },
    '*': {
      signal: { kind: 'claude-session', sessionId: 'replay-default' },
      pr: { number: 9002, headRef: '{branch}', body: 'Implements {issue}.\n\n{trailer}' },
    },
  },
};

runBackendConformance({
  name: 'ReplayBackend (cassette)',
  makeBackend: (gh) => new ReplayBackend(gh, cassette, { id: 'claude' }),
});

describe('capability presets (0084)', () => {
  it('mirror the three real backends’ distinguishing capability flags', () => {
    expect(claudeLike().triggerModes).toEqual(['api_fire']);
    expect(claudeLike().zdrCompatible).toBe(false);

    expect(codexLike().triggerModes).toEqual(['mention']);
    expect(codexLike().secretPhase).toBe('setup-only');
    expect(codexLike().throughput.tasksPerHour).toBe(5);

    expect(selfHostedLike().triggerModes).toEqual(['self_hosted_dispatch']);
    expect(selfHostedLike().zdrCompatible).toBe(true); // the differentiator
    expect(selfHostedLike().throughput.tasksPerHour).toBeNull();
  });

  it('accept overrides for exercising specific runner branches', () => {
    expect(claudeLike({ zdrCompatible: true }).zdrCompatible).toBe(true);
    expect(codexLike({ throughput: { tasksPerHour: 99 } }).throughput.tasksPerHour).toBe(99);
  });
});
