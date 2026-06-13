import type { ResilienceConfig } from '../transitions/loop-definition.js';
import { DEFAULT_RETRY, type RetryPolicy } from './retry.js';
import { DEFAULT_BREAKER, DEFAULT_CEILING, type BreakerPolicy, type Ceiling } from './breaker.js';

/**
 * Normalize the config-resolved `resilience` block (task 0091 — seconds/minutes,
 * partial, already merged repo→per-loop by `@looper/config`) into the ms-based
 * policy types the runtime (0089/0090) consumes. Absent fields fall back to the
 * safe defaults, so the runtime always gets a complete policy.
 */

export function toRetryPolicy(r?: ResilienceConfig): RetryPolicy {
  const ret = r?.retries;
  if (!ret) return DEFAULT_RETRY;
  return {
    max: ret.max,
    backoff: ret.backoff,
    baseMs: ret.baseSeconds * 1000,
    capMs: ret.capSeconds * 1000,
  };
}

export function toCeiling(r?: ResilienceConfig): Ceiling {
  const c = r?.maxInFlight;
  if (!c) return DEFAULT_CEILING;
  return {
    global: c.global ?? DEFAULT_CEILING.global,
    perLoop: c.perLoop ?? DEFAULT_CEILING.perLoop,
  };
}

export function toBreakerPolicy(r?: ResilienceConfig): BreakerPolicy {
  const b = r?.circuitBreaker;
  if (!b) return DEFAULT_BREAKER;
  return {
    consecutiveFailures: b.consecutiveFailures,
    cooldownMs: b.cooldownMinutes * 60_000,
  };
}

export function dispatchTimeoutMs(r?: ResilienceConfig): number {
  return (r?.dispatchTimeoutMinutes ?? 30) * 60_000;
}

export function maxAttemptsPerItem(r?: ResilienceConfig): number {
  return r?.maxAttemptsPerItem ?? 3;
}

export function maxFixAttempts(r?: ResilienceConfig): number {
  return r?.maxFixAttempts ?? 2;
}

export function onFailureMode(r?: ResilienceConfig): 'needs-human' | 'retry' | 'abandon' {
  return r?.onFailure ?? 'needs-human';
}

export function escalateTo(r?: ResilienceConfig): string | undefined {
  return r?.escalateTo;
}
