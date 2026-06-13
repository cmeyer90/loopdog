import type { RunRecord } from '@looper/core';
import {
  CLAIM_LABEL_PREFIX,
  LEASE_LABEL_PREFIX,
  LOCK_LABEL_PREFIX,
  STATE_LABEL_PREFIX,
  stateOfLabels,
} from '@looper/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';

/**
 * Core invariant checkers (task 0086). Each reads ONLY fake state + run
 * records — no test-only hooks into the runtime — and returns a violation
 * with a readable detail, or null when it holds. The simulation engine runs
 * the whole set after every step and at quiescence.
 */
export interface Violation {
  invariant: string;
  detail: string;
}

export interface InvariantInput {
  gh: FakeGitHub;
  records: readonly RunRecord[];
  /** States that are "actionable" (a loop's from-state) — for stranding. */
  actionableStates?: ReadonlySet<string>;
  /** Lease expiry instant resolver; defaults: a lease whose label decodes a past time is expired. */
  now?: () => Date;
}

export type Invariant = (input: InvariantInput) => Violation | null;

const itemKey = (r: RunRecord): string =>
  `${r.loop}:${r.item.owner}/${r.item.repo}#${r.item.number}`;

/**
 * ≤1 effective dispatch per (loop, item, from-state) idempotency key. A
 * dispatch is "effective" when a run record carries a `dispatch` step (or a
 * pending/started outcome with a dispatch artifact). Correlated re-ingests
 * (status done/failed produced by a later ingest of the SAME run) don't count
 * — they share the runId. We count DISTINCT runIds with a dispatch step per
 * idempotency key; >1 means the claim+key failed to collapse a race/storm.
 */
export const noDoubleDispatch: Invariant = ({ records }) => {
  const byKey = new Map<string, Set<string>>();
  for (const r of records) {
    const dispatched = r.steps.some((s) => s.kind === 'dispatch');
    if (!dispatched) continue;
    const key = itemKey(r);
    const set = byKey.get(key) ?? new Set<string>();
    set.add(r.runId);
    byKey.set(key, set);
  }
  for (const [key, runIds] of byKey) {
    // Distinct attempts (a0, a1, …) are legal sequential retries; what's
    // forbidden is two LIVE dispatches for the same attempt slot. The runId
    // encodes the attempt (`-a<n>-`), so duplicates within one attempt share
    // a runId — more than one runId for the same attempt index is the bug.
    const byAttempt = new Map<string, number>();
    for (const id of runIds) {
      const attempt = id.match(/-a(\d+)-/)?.[1] ?? '0';
      byAttempt.set(attempt, (byAttempt.get(attempt) ?? 0) + 1);
    }
    for (const [attempt, count] of byAttempt) {
      if (count > 1) {
        return {
          invariant: 'noDoubleDispatch',
          detail: `${key} attempt a${attempt} dispatched ${count}× (expected ≤1)`,
        };
      }
    }
  }
  return null;
};

/**
 * Idempotent ingest: the same correlated result delivered N times yields one
 * effect. Count run records with an `ingest` step that produced a terminal
 * transition; for a given (loop, item, runId) there must be at most one such
 * effective ingest (re-delivery must be a no-op).
 */
export const idempotentIngest: Invariant = ({ records }) => {
  const ingestEffects = new Map<string, number>();
  for (const r of records) {
    const ingested = r.steps.some((s) => s.kind === 'ingest');
    const transitioned = Boolean(r.outcome.transition);
    if (ingested && transitioned) {
      ingestEffects.set(r.runId, (ingestEffects.get(r.runId) ?? 0) + 1);
    }
  }
  for (const [runId, count] of ingestEffects) {
    if (count > 1) {
      return {
        invariant: 'idempotentIngest',
        detail: `runId ${runId} produced ${count} ingest transitions (expected 1)`,
      };
    }
  }
  return null;
};

/**
 * Claim exclusivity: at most one live claim/lease holder per item at any step.
 * Reads the labels directly — two distinct `looper:claimed-by/*` (or lock)
 * markers on one item is a violation.
 */
export const claimExclusivity: Invariant = ({ gh }) => {
  const all = gh.dump();
  for (const item of [...all.issues, ...all.pulls]) {
    const claims = item.labels.filter(
      (l) => l.startsWith(CLAIM_LABEL_PREFIX) || l.startsWith(LOCK_LABEL_PREFIX),
    );
    if (claims.length > 1) {
      return {
        invariant: 'claimExclusivity',
        detail: `#${item.ref.number} holds ${claims.length} claim/lock markers: ${claims.join(', ')}`,
      };
    }
  }
  return null;
};

/**
 * No stranded items: no item sits in an actionable state holding an EXPIRED
 * claim/lease with no in-flight artifact. A managed item must be terminal/
 * parked, genuinely in-flight (a pending run record), or recovering (a claim
 * whose lease is still in the future — the holder may yet finish, and after
 * expiry the sweep reclaims it). A claim whose lease has already lapsed with no
 * pending run is stranded: the holder vanished and nothing released it.
 */
export const noStrandedItems: Invariant = ({ gh, records, now }) => {
  const all = gh.dump();
  const at = (now ?? (() => new Date())).call(null).getTime();
  const pendingItems = new Set(
    records
      .filter((r) => r.outcome.status === 'pending')
      .map((r) => `${r.item.owner}/${r.item.repo}#${r.item.number}`),
  );
  for (const item of [...all.issues, ...all.pulls]) {
    if (item.state === 'closed') continue;
    const state = stateOfLabels(item.labels);
    if (!state) continue; // unmanaged
    const hasClaim = item.labels.some((l) => l.startsWith(CLAIM_LABEL_PREFIX));
    const leaseLabel = item.labels.find((l) => l.startsWith(LEASE_LABEL_PREFIX));
    const key = `${item.ref.owner}/${item.ref.repo}#${item.ref.number}`;
    if (pendingItems.has(key)) continue; // genuinely in-flight
    if (!hasClaim && !leaseLabel) continue; // free to be swept
    // A claim/lease with no in-flight run: stranded only once the lease lapsed
    // (before that it's recovering; after, the sweep should have reclaimed it).
    const leaseExpiry = leaseLabel ? Date.parse(leaseLabel.slice(LEASE_LABEL_PREFIX.length)) : NaN;
    const lapsed = Number.isNaN(leaseExpiry) || leaseExpiry <= at;
    if (lapsed) {
      return {
        invariant: 'noStrandedItems',
        detail: `#${item.ref.number} (state ${state}) holds a claim/lease (expiry ${leaseLabel?.slice(LEASE_LABEL_PREFIX.length) ?? 'none'}) past its lease with no in-flight run`,
      };
    }
  }
  return null;
};

/**
 * Monotonic state: an item never carries two lifecycle state labels at once
 * (a regression/partial-write would leave both). The transition table is the
 * authority on legal edges; here we assert the structural single-state
 * invariant the label plan guarantees (M03).
 */
export const monotonicState: Invariant = ({ gh }) => {
  const all = gh.dump();
  for (const item of [...all.issues, ...all.pulls]) {
    const states = item.labels.filter((l) => l.startsWith(STATE_LABEL_PREFIX));
    if (states.length > 1) {
      return {
        invariant: 'monotonicState',
        detail: `#${item.ref.number} carries ${states.length} state labels: ${states.join(', ')}`,
      };
    }
  }
  return null;
};

export const ALL_INVARIANTS: Invariant[] = [
  noDoubleDispatch,
  idempotentIngest,
  claimExclusivity,
  noStrandedItems,
  monotonicState,
];

/** Run every invariant; returns all violations (empty = healthy). */
export function checkInvariants(
  input: InvariantInput,
  invariants: Invariant[] = ALL_INVARIANTS,
): Violation[] {
  const violations: Violation[] = [];
  for (const inv of invariants) {
    const v = inv(input);
    if (v) violations.push(v);
  }
  return violations;
}
