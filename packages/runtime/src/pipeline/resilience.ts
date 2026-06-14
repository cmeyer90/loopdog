import type { BreakerPolicy, BreakerState, InFlight, RunRecord } from '@loopdog/core';

/**
 * Runtime resilience helpers (M19 · 0090): derive the concurrency in-flight
 * count and the per-(loop,backend) circuit-breaker state from the run-record
 * ledger — the same no-side-DB pattern the budget/quota gates use (the ledger
 * lives on the `loopdog/telemetry` branch, i.e. GitHub state). No new marker.
 */

/**
 * Items currently in flight = runIds with a `pending` (dispatched, not yet
 * ingested) record and no later terminal record for the same runId. Returned
 * globally and per loop.
 */
export function inFlightFromLedger(records: readonly RunRecord[]): {
  global: number;
  perLoop: Map<string, number>;
} {
  const terminal = new Set(
    records.filter((r) => r.outcome.status !== 'pending').map((r) => r.runId),
  );
  const live = new Map<string, string>(); // runId -> loop (dedup by runId)
  for (const r of records) {
    if (r.outcome.status === 'pending' && !terminal.has(r.runId)) live.set(r.runId, r.loop);
  }
  const perLoop = new Map<string, number>();
  for (const loop of live.values()) perLoop.set(loop, (perLoop.get(loop) ?? 0) + 1);
  return { global: live.size, perLoop };
}

/** The in-flight pair for one loop. */
export function inFlightFor(records: readonly RunRecord[], loop: string): InFlight {
  const { global, perLoop } = inFlightFromLedger(records);
  return { global, loop: perLoop.get(loop) ?? 0 };
}

/**
 * Derive the circuit-breaker state for a (loop, backend) from the ledger: the
 * trailing run of CONSECUTIVE provider failures (most-recent first). A success
 * (done/pending) or a content failure breaks the streak. `openedAt` is stamped
 * at the instant the streak first reached the threshold (the Nth failure's
 * timestamp), so the cooldown is measured from when it tripped.
 */
export function breakerStateFromLedger(
  records: readonly RunRecord[],
  loop: string,
  backend: string,
  policy: BreakerPolicy,
): BreakerState {
  const relevant = records
    .filter((r) => r.loop === loop && r.backend === backend)
    .filter((r) => r.outcome.status !== 'parked' && r.outcome.status !== 'skipped')
    .slice()
    .sort((a, b) => Date.parse(a.trigger.at) - Date.parse(b.trigger.at));

  let streak = 0;
  let openedAt: string | undefined;
  for (const r of relevant) {
    if (isProviderFailure(r)) {
      streak += 1;
      if (streak >= policy.consecutiveFailures && !openedAt) openedAt = r.trigger.at;
    } else if (r.outcome.status === 'done' || r.outcome.status === 'pending') {
      streak = 0;
      openedAt = undefined; // a success closes it
    }
    // a non-provider failure neither extends nor resets — leave the streak.
  }
  return openedAt ? { consecutiveFailures: streak, openedAt } : { consecutiveFailures: streak };
}

/** A provider/dispatch failure (vs a content failure like CI-red/review-reject). */
function isProviderFailure(r: RunRecord): boolean {
  if (r.outcome.status !== 'failed' && r.outcome.status !== 'escalated') return false;
  const cls = r.outcome.failure?.class;
  // provider-class failures trip the breaker; budget/overload never do (those
  // are deferrals, not outages), and content rejects aren't recorded as failures.
  return cls === 'transient' || cls === 'terminal' || cls === 'poisoned';
}
