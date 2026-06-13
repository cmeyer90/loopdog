import type { RunRecord } from '../run-record/run-record.js';

/**
 * Pre-flight guards (M12): kill switch (0050), budgets (0050), and
 * subscription quota (0075) — pure predicates composed cheap→expensive by the
 * runtime pre-flight. The first denial wins; quota/budget denials PARK
 * (deferred, never failed) with a retryAfter the sweep honors.
 */

export type GuardVerdict =
  | { allowed: true }
  | {
      allowed: false;
      guard: 'kill-switch' | 'budget' | 'quota' | 'circuit';
      reason: string;
      /** When the sweep may retry (absent = held until a human clears it). */
      retryAfter?: string | undefined;
    };

// ---- kill switch (0050) ----

export function killSwitchGate(state: {
  variableSet: boolean;
  labelPresent: boolean;
}): GuardVerdict {
  if (state.variableSet) {
    return { allowed: false, guard: 'kill-switch', reason: 'repo variable LOOPER_STOP is set' };
  }
  if (state.labelPresent) {
    return { allowed: false, guard: 'kill-switch', reason: 'looper:stop label present' };
  }
  return { allowed: true };
}

// ---- budgets (0050) ----

export interface BudgetCeilings {
  windowMs: number;
  global: { maxDispatches: number; maxUsd: number };
  perLoop: { maxDispatches: number; maxUsd: number };
}

export interface LedgerStats {
  globalDispatches: number;
  globalUsd: number;
  loopDispatches: number;
  loopUsd: number;
}

/** Aggregate the run-record ledger for one loop over a window (pure). */
export function ledgerStats(records: readonly RunRecord[], loop: string, since: Date): LedgerStats {
  const inWindow = records.filter(
    (r) => Date.parse(r.trigger.at) >= since.getTime() && isDispatch(r),
  );
  const loopRecords = inWindow.filter((r) => r.loop === loop);
  return {
    globalDispatches: inWindow.length,
    globalUsd: sumUsd(inWindow),
    loopDispatches: loopRecords.length,
    loopUsd: sumUsd(loopRecords),
  };
}

function isDispatch(record: RunRecord): boolean {
  return record.steps.some((s) => s.kind === 'dispatch' && !s.detail.startsWith('failed'));
}

function sumUsd(records: readonly RunRecord[]): number {
  return records.reduce((sum, r) => sum + (r.cost.usd ?? 0), 0);
}

/** Would one more dispatch cross a ceiling? 0 = unlimited. */
export function budgetGate(stats: LedgerStats, ceilings: BudgetCeilings): GuardVerdict {
  const checks: Array<[number, number, string]> = [
    [stats.globalDispatches, ceilings.global.maxDispatches, 'global max_dispatches'],
    [stats.loopDispatches, ceilings.perLoop.maxDispatches, 'per-loop max_dispatches'],
  ];
  for (const [spent, ceiling, name] of checks) {
    if (ceiling > 0 && spent + 1 > ceiling) {
      return {
        allowed: false,
        guard: 'budget',
        reason: `${name} (${ceiling}) reached for the window`,
      };
    }
  }
  const usd: Array<[number, number, string]> = [
    [stats.globalUsd, ceilings.global.maxUsd, 'global max_usd'],
    [stats.loopUsd, ceilings.perLoop.maxUsd, 'per-loop max_usd'],
  ];
  for (const [spent, ceiling, name] of usd) {
    if (ceiling > 0 && spent >= ceiling) {
      return { allowed: false, guard: 'budget', reason: `${name} ($${ceiling}) reached` };
    }
  }
  return { allowed: true };
}

// ---- subscription quota (0075) ----

export interface QuotaModel {
  windowMs: number;
  maxDispatches: number;
  /** rolling (codex ~5/hr) vs calendar UTC (claude daily). */
  kind: 'rolling' | 'calendar';
}

/** Dispatch count for a backend within its quota window (pure). */
export function backendDispatchesInWindow(
  records: readonly RunRecord[],
  backend: string,
  model: QuotaModel,
  now: Date,
): number {
  const windowStart =
    model.kind === 'calendar'
      ? Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z')
      : now.getTime() - model.windowMs;
  return records.filter(
    (r) => r.backend === backend && Date.parse(r.trigger.at) >= windowStart && isDispatch(r),
  ).length;
}

/** Throttle/queue, never fail: park with the next window slot as retryAfter. */
export function quotaGate(
  dispatchesInWindow: number,
  backend: string,
  model: QuotaModel | undefined,
  now: Date,
): GuardVerdict {
  if (!model || model.maxDispatches <= 0) return { allowed: true }; // uncapped
  if (dispatchesInWindow + 1 <= model.maxDispatches) return { allowed: true };
  const retryAfter =
    model.kind === 'calendar'
      ? new Date(Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z') + 86_400_000)
      : new Date(now.getTime() + model.windowMs);
  return {
    allowed: false,
    guard: 'quota',
    reason: `${backend} quota (${model.maxDispatches}/${model.kind} window) exhausted — deferring`,
    retryAfter: retryAfter.toISOString(),
  };
}

// ---- backoff timer (0051) ----

/** Exponential backoff for re-attempts: base * 2^(attempts-1), capped. */
export function backoffUntil(
  attempts: number,
  now: Date,
  baseSeconds = 30,
  capSeconds = 600,
): string {
  const delay = Math.min(baseSeconds * 2 ** Math.max(0, attempts - 1), capSeconds);
  return new Date(now.getTime() + delay * 1000).toISOString();
}

export const NOT_BEFORE_PREFIX = 'looper:not-before/';

export function notBeforeLabel(until: string): string {
  return `${NOT_BEFORE_PREFIX}${until}`;
}

export function parseNotBefore(labels: readonly string[]): string | null {
  const label = labels.find((l) => l.startsWith(NOT_BEFORE_PREFIX));
  return label ? label.slice(NOT_BEFORE_PREFIX.length) : null;
}
