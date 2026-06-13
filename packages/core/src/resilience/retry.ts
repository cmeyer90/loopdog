/**
 * Retry / backoff policy (task 0089): generalizes 0051's exponential
 * `backoffUntil` into a config-driven engine — three backoff shapes + full
 * jitter — plus a per-dispatch retry budget distinct from the item-level
 * attempt counter. Pure: the sweep (never a busy loop) re-arms after the
 * computed `not_before`.
 */

export type BackoffShape = 'exponential' | 'linear' | 'constant';

export interface RetryPolicy {
  /** Max per-dispatch retries before rolling into the item attempt counter. */
  max: number;
  backoff: BackoffShape;
  baseMs: number;
  capMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  max: 2,
  backoff: 'exponential',
  baseMs: 30_000, // 30s
  capMs: 600_000, // 10m
};

/**
 * The deterministic backoff CEILING for `attempt` (1-based) — the documented
 * schedule, before jitter, capped. exponential: base·2^(n-1); linear: base·n;
 * constant: base.
 */
export function backoffCeilingMs(policy: RetryPolicy, attempt: number): number {
  const n = Math.max(1, attempt);
  const raw =
    policy.backoff === 'exponential'
      ? policy.baseMs * 2 ** (n - 1)
      : policy.backoff === 'linear'
        ? policy.baseMs * n
        : policy.baseMs;
  return Math.min(raw, policy.capMs);
}

/**
 * The actual delay with FULL jitter: a uniform draw in [0, ceiling]. `rng`
 * defaults to `Math.random`; tests/simulation inject a deterministic source.
 */
export function backoffDelayMs(
  policy: RetryPolicy,
  attempt: number,
  rng: () => number = Math.random,
): number {
  const ceiling = backoffCeilingMs(policy, attempt);
  return Math.floor(rng() * ceiling);
}

/** The `not_before` instant for the next retry of `attempt` (ISO). */
export function nextRetryAt(
  policy: RetryPolicy,
  attempt: number,
  now: Date,
  rng: () => number = Math.random,
): string {
  return new Date(now.getTime() + backoffDelayMs(policy, attempt, rng)).toISOString();
}

/** Whether a per-dispatch retry budget remains (retry_count is 0-based prior tries). */
export function hasRetryBudget(policy: RetryPolicy, retryCount: number): boolean {
  return retryCount < policy.max;
}
