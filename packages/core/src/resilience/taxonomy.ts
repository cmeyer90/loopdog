import type { FailureClass } from '../run-record/run-record.js';

/**
 * Failure taxonomy (task 0088): the pure decision spine M19 is built on. A
 * failed (or pre-empted) transition is classified into exactly one
 * `FailureClass`, and each class maps to exactly one deterministic `Response`.
 * No IO — the runtime (0089/0090/0091) builds the `FailureSignal` and applies
 * the `Response`; this module owns the *map*, not the *effects*.
 *
 * The five classes (source of truth: run-record `FailureClass`):
 *   transient — a recoverable hiccup (provider blip, timeout) → RETRY w/ backoff
 *   terminal  — an unrecoverable error → ESCALATE to a human
 *   poisoned  — the item failed every attempt → QUARANTINE
 *   overload  — too much already in flight → DEFER (try later)
 *   budget    — out of budget/quota → PAUSE (park, never spend)
 */

export type { FailureClass } from '../run-record/run-record.js';

export type ResponseKind = 'retry' | 'escalate' | 'quarantine' | 'defer' | 'pause';

export interface Response {
  kind: ResponseKind;
  /** The class that produced it (for the run record + diagnostics). */
  class: FailureClass;
}

/**
 * The typed signal the runtime builds from a failed/pre-empted transition.
 * `classify` reads it in a fixed precedence; nothing here does IO.
 */
export interface FailureSignal {
  /** A pre-flight spend gate denied (budget/quota). Highest precedence. */
  spendDenied?: boolean | undefined;
  /** The concurrency ceiling (0090) was already met for this candidate. */
  overCeiling?: boolean | undefined;
  /**
   * The backend/dispatch error, when one occurred. `recoverable: false` is an
   * unrecoverable (terminal) provider/protocol error; an ABSENT error is
   * treated as recoverable (fail-open → transient, never terminal).
   */
  backendError?: { recoverable: boolean } | undefined;
  /** Item-level attempt accounting (the 0051 counter). */
  attempts: number;
  maxAttempts: number;
}

/**
 * Classify a failure. Precedence (first match wins, total — no `default`):
 *   1. spendDenied            → budget
 *   2. overCeiling            → overload
 *   3. unrecoverable error    → terminal
 *   4. attempts exhausted     → poisoned
 *   5. otherwise (fail-open)  → transient
 */
export function classify(signal: FailureSignal): FailureClass {
  if (signal.spendDenied) return 'budget';
  if (signal.overCeiling) return 'overload';
  if (signal.backendError && signal.backendError.recoverable === false) return 'terminal';
  if (signal.attempts >= signal.maxAttempts) return 'poisoned';
  return 'transient';
}

/** Map every class to exactly one response (total over the enum). */
export function responseFor(cls: FailureClass): Response {
  switch (cls) {
    case 'transient':
      return { kind: 'retry', class: cls };
    case 'terminal':
      return { kind: 'escalate', class: cls };
    case 'poisoned':
      return { kind: 'quarantine', class: cls };
    case 'overload':
      return { kind: 'defer', class: cls };
    case 'budget':
      return { kind: 'pause', class: cls };
  }
}

/**
 * The attempt-increment contract: `retry`/`escalate`/`quarantine` follow a real
 * failure (the item burned an attempt), so they increment the counter; `defer`
 * (overload) and `pause` (budget) are NOT the item's fault — they consume no
 * attempt, so the item is re-tried cleanly once headroom/budget returns.
 */
export function incrementsAttempt(response: Response): boolean {
  switch (response.kind) {
    case 'retry':
    case 'escalate':
    case 'quarantine':
      return true;
    case 'defer':
    case 'pause':
      return false;
  }
}

/** Convenience: classify + map in one call. */
export function classifyResponse(signal: FailureSignal): Response {
  return responseFor(classify(signal));
}
