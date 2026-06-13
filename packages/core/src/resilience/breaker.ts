/**
 * Concurrency ceiling + circuit breaker (task 0090): two pure pre-flight gates
 * that keep looper from overrunning itself or a sick provider. No IO — the
 * runtime supplies the in-flight count + persisted breaker state and applies
 * the decisions (defer / pause-loop).
 */

// ---- concurrency ceiling ----

export interface Ceiling {
  /** Max items in flight across all loops; 0 = unlimited. */
  global: number;
  /** Max items in flight for one loop; 0 = unlimited. */
  perLoop: number;
}

export const DEFAULT_CEILING: Ceiling = { global: 10, perLoop: 4 };

export interface InFlight {
  global: number;
  loop: number;
}

export type CeilingDecision = { admit: true } | { admit: false; reason: string };

/**
 * Admit a new dispatch only if it stays within both ceilings. A denial DEFERS
 * (the candidate is untouched; the sweep retries when headroom frees) — it is
 * not a failure and burns no attempt.
 */
export function checkCeiling(inFlight: InFlight, ceiling: Ceiling): CeilingDecision {
  if (ceiling.global > 0 && inFlight.global >= ceiling.global) {
    return { admit: false, reason: `global max_in_flight (${ceiling.global}) reached` };
  }
  if (ceiling.perLoop > 0 && inFlight.loop >= ceiling.perLoop) {
    return { admit: false, reason: `per-loop max_in_flight (${ceiling.perLoop}) reached` };
  }
  return { admit: true };
}

// ---- circuit breaker ----

export interface BreakerPolicy {
  /** Consecutive provider failures that open the circuit. */
  consecutiveFailures: number;
  cooldownMs: number;
}

export const DEFAULT_BREAKER: BreakerPolicy = {
  consecutiveFailures: 5,
  cooldownMs: 3_600_000, // 1h
};

export type BreakerStatus = 'closed' | 'open' | 'half-open';

/** Persisted per (loop, backend): failure streak + when it last opened. */
export interface BreakerState {
  consecutiveFailures: number;
  /** ISO when the circuit opened; absent = closed. */
  openedAt?: string | undefined;
}

export const CLOSED: BreakerState = { consecutiveFailures: 0 };

export type BreakerDecision =
  | { status: 'closed'; admit: true }
  | { status: 'half-open'; admit: true; probe: true }
  | { status: 'open'; admit: false; reason: string; retryAfter: string };

/**
 * The breaker's current verdict. Open → reject until cooldown elapses, then
 * half-open admits exactly one probe (the runtime enforces single-flight).
 */
export function breakerStatus(
  state: BreakerState,
  policy: BreakerPolicy,
  now: Date,
): BreakerDecision {
  if (!state.openedAt) return { status: 'closed', admit: true };
  const elapsed = now.getTime() - Date.parse(state.openedAt);
  if (elapsed >= policy.cooldownMs) {
    return { status: 'half-open', admit: true, probe: true };
  }
  const retryAfter = new Date(Date.parse(state.openedAt) + policy.cooldownMs).toISOString();
  return {
    status: 'open',
    admit: false,
    reason: `circuit open (≥${policy.consecutiveFailures} consecutive provider failures); cooling down`,
    retryAfter,
  };
}

/**
 * Fold a PROVIDER failure into the state: increment the streak and open the
 * circuit when it reaches the threshold (a half-open probe failing re-opens it
 * with a fresh cooldown). Content failures (CI red / review reject) must NOT be
 * fed here — only provider/dispatch failures trip the breaker.
 */
export function onFailure(state: BreakerState, policy: BreakerPolicy, now: Date): BreakerState {
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= policy.consecutiveFailures) {
    return { consecutiveFailures, openedAt: now.toISOString() };
  }
  return { consecutiveFailures };
}

/** A success closes the circuit and resets the streak (probe success or normal). */
export function onSuccess(): BreakerState {
  return { ...CLOSED };
}
