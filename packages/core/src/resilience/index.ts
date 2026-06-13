// Resilience & failure policy (M19): pure taxonomy + retry/backoff + concurrency
// ceiling + circuit breaker + the resolved config knobs. No IO.
export type { FailureClass, Response, ResponseKind, FailureSignal } from './taxonomy.js';
export { classify, responseFor, incrementsAttempt, classifyResponse } from './taxonomy.js';
export type { BackoffShape, RetryPolicy } from './retry.js';
export {
  DEFAULT_RETRY,
  backoffCeilingMs,
  backoffDelayMs,
  nextRetryAt,
  hasRetryBudget,
} from './retry.js';
export type {
  Ceiling,
  InFlight,
  CeilingDecision,
  BreakerPolicy,
  BreakerStatus,
  BreakerState,
  BreakerDecision,
} from './breaker.js';
export {
  DEFAULT_CEILING,
  DEFAULT_BREAKER,
  CLOSED,
  checkCeiling,
  breakerStatus,
  onFailure,
  onSuccess,
} from './breaker.js';
export {
  toRetryPolicy,
  toCeiling,
  toBreakerPolicy,
  dispatchTimeoutMs,
  maxAttemptsPerItem,
  maxFixAttempts,
  onFailureMode,
  escalateTo,
} from './normalize.js';
