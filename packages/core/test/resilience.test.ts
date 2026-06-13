import { describe, expect, it } from 'vitest';
import {
  backoffCeilingMs,
  backoffDelayMs,
  breakerStatus,
  checkCeiling,
  classify,
  classifyResponse,
  DEFAULT_BREAKER,
  hasRetryBudget,
  incrementsAttempt,
  nextRetryAt,
  onFailure,
  onSuccess,
  responseFor,
  type BreakerState,
  type FailureClass,
  type FailureSignal,
  type RetryPolicy,
} from '@looper/core';

/**
 * Resilience pure cores (M19 · 0088/0089/0090): the failure taxonomy classifier
 * + response map, the config-driven backoff engine, and the concurrency ceiling
 * + circuit breaker — all IO-free, exercised across their boundaries.
 */

const sig = (over: Partial<FailureSignal> = {}): FailureSignal => ({
  attempts: 0,
  maxAttempts: 3,
  ...over,
});

describe('failure taxonomy (0088)', () => {
  it('classifies by the documented precedence (spend → ceiling → terminal → poisoned → transient)', () => {
    // 1. spend denied wins over everything.
    expect(classify(sig({ spendDenied: true, overCeiling: true, attempts: 9 }))).toBe('budget');
    // 2. over-ceiling beats terminal/poisoned/transient.
    expect(
      classify(sig({ overCeiling: true, backendError: { recoverable: false }, attempts: 9 })),
    ).toBe('overload');
    // 3. unrecoverable error → terminal (even with attempts remaining).
    expect(classify(sig({ backendError: { recoverable: false }, attempts: 0 }))).toBe('terminal');
    // 4. attempts exhausted → poisoned.
    expect(classify(sig({ attempts: 3, maxAttempts: 3 }))).toBe('poisoned');
    // 5. otherwise → transient.
    expect(classify(sig({ attempts: 1, maxAttempts: 3 }))).toBe('transient');
  });

  it('fail-open: absent/recoverable error with attempts remaining is transient, never terminal', () => {
    expect(classify(sig({ backendError: undefined, attempts: 1 }))).toBe('transient');
    expect(classify(sig({ backendError: { recoverable: true }, attempts: 1 }))).toBe('transient');
    // ...but exhausted → poisoned.
    expect(
      classify(sig({ backendError: { recoverable: true }, attempts: 3, maxAttempts: 3 })),
    ).toBe('poisoned');
  });

  it('maps every class to exactly one response (total)', () => {
    const map: Record<FailureClass, string> = {
      transient: 'retry',
      terminal: 'escalate',
      poisoned: 'quarantine',
      overload: 'defer',
      budget: 'pause',
    };
    for (const [cls, kind] of Object.entries(map)) {
      expect(responseFor(cls as FailureClass).kind).toBe(kind);
    }
  });

  it('attempt-increment contract: retry/escalate/quarantine increment; defer/pause do not', () => {
    expect(incrementsAttempt(responseFor('transient'))).toBe(true);
    expect(incrementsAttempt(responseFor('terminal'))).toBe(true);
    expect(incrementsAttempt(responseFor('poisoned'))).toBe(true);
    expect(incrementsAttempt(responseFor('overload'))).toBe(false);
    expect(incrementsAttempt(responseFor('budget'))).toBe(false);
  });

  it('classifyResponse composes classify + responseFor', () => {
    expect(classifyResponse(sig({ spendDenied: true })).kind).toBe('pause');
    expect(classifyResponse(sig({ attempts: 3, maxAttempts: 3 })).kind).toBe('quarantine');
  });
});

describe('retry / backoff (0089)', () => {
  const exp: RetryPolicy = { max: 2, backoff: 'exponential', baseMs: 30_000, capMs: 600_000 };
  const lin: RetryPolicy = { max: 5, backoff: 'linear', baseMs: 10_000, capMs: 600_000 };
  const con: RetryPolicy = { max: 5, backoff: 'constant', baseMs: 15_000, capMs: 600_000 };

  it('each shape produces the documented schedule, capped', () => {
    expect([1, 2, 3, 10].map((n) => backoffCeilingMs(exp, n))).toEqual([
      30_000,
      60_000,
      120_000,
      600_000, // base·2^(n-1), capped at 10m
    ]);
    expect([1, 2, 3].map((n) => backoffCeilingMs(lin, n))).toEqual([10_000, 20_000, 30_000]);
    expect([1, 2, 3].map((n) => backoffCeilingMs(con, n))).toEqual([15_000, 15_000, 15_000]);
  });

  it('full jitter stays within [0, ceiling]', () => {
    for (const r of [0, 0.5, 0.999]) {
      const d = backoffDelayMs(exp, 3, () => r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(backoffCeilingMs(exp, 3));
    }
    expect(backoffDelayMs(exp, 3, () => 0)).toBe(0);
  });

  it('nextRetryAt offsets now by the jittered delay; retry budget is per-dispatch', () => {
    const now = new Date('2026-06-09T12:00:00Z');
    expect(nextRetryAt(exp, 1, now, () => 1).startsWith('2026-06-09T12:00:')).toBe(true);
    expect(hasRetryBudget(exp, 0)).toBe(true);
    expect(hasRetryBudget(exp, 1)).toBe(true);
    expect(hasRetryBudget(exp, 2)).toBe(false); // max=2 exhausted
  });
});

describe('concurrency ceiling (0090)', () => {
  const ceiling = { global: 10, perLoop: 4 };
  it('admits under both ceilings, defers at either', () => {
    expect(checkCeiling({ global: 3, loop: 2 }, ceiling).admit).toBe(true);
    expect(checkCeiling({ global: 10, loop: 0 }, ceiling)).toMatchObject({ admit: false });
    expect(checkCeiling({ global: 0, loop: 4 }, ceiling)).toMatchObject({ admit: false });
  });
  it('treats 0 as unlimited', () => {
    expect(checkCeiling({ global: 999, loop: 999 }, { global: 0, perLoop: 0 }).admit).toBe(true);
  });
});

describe('circuit breaker (0090)', () => {
  const t0 = new Date('2026-06-09T12:00:00Z');
  it('opens after N consecutive provider failures', () => {
    let st: BreakerState = { consecutiveFailures: 0 };
    for (let i = 0; i < DEFAULT_BREAKER.consecutiveFailures - 1; i++) {
      st = onFailure(st, DEFAULT_BREAKER, t0);
      expect(breakerStatus(st, DEFAULT_BREAKER, t0).status).toBe('closed');
    }
    st = onFailure(st, DEFAULT_BREAKER, t0); // the 5th
    expect(breakerStatus(st, DEFAULT_BREAKER, t0)).toMatchObject({ status: 'open', admit: false });
  });

  it('half-opens after cooldown, a probe success closes, a probe failure re-opens', () => {
    let st: BreakerState = { consecutiveFailures: 5, openedAt: t0.toISOString() };
    // before cooldown → still open
    const mid = new Date(t0.getTime() + 30 * 60_000);
    expect(breakerStatus(st, DEFAULT_BREAKER, mid).status).toBe('open');
    // after cooldown → half-open (one probe)
    const after = new Date(t0.getTime() + DEFAULT_BREAKER.cooldownMs + 1);
    expect(breakerStatus(st, DEFAULT_BREAKER, after)).toMatchObject({
      status: 'half-open',
      probe: true,
    });
    // probe success → closed
    expect(breakerStatus(onSuccess(), DEFAULT_BREAKER, after).status).toBe('closed');
    // probe failure → re-open with a fresh cooldown
    st = onFailure(st, DEFAULT_BREAKER, after);
    expect(breakerStatus(st, DEFAULT_BREAKER, after).status).toBe('open');
  });
});
