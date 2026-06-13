import type { RunRecord } from '@looper/core';

/**
 * Per-provider outcome telemetry (task 0053): aggregate the run-record ledger
 * per (loop, backend) so routing (M13) and the CLI are data-driven. Pure.
 */
export interface OutcomeAggregate {
  loop: string;
  backend: string;
  dispatches: number;
  done: number;
  failed: number;
  escalated: number;
  parked: number;
  /** done / (done + failed + escalated); null below the sample floor. */
  successRate: number | null;
}

export function aggregateOutcomes(
  records: readonly RunRecord[],
  minSamples = 1,
): OutcomeAggregate[] {
  const byKey = new Map<string, OutcomeAggregate>();
  for (const record of records) {
    const key = `${record.loop} ${record.backend}`;
    const agg =
      byKey.get(key) ??
      ({
        loop: record.loop,
        backend: record.backend,
        dispatches: 0,
        done: 0,
        failed: 0,
        escalated: 0,
        parked: 0,
        successRate: null,
      } satisfies OutcomeAggregate);
    if (record.steps.some((s) => s.kind === 'dispatch')) agg.dispatches++;
    if (record.outcome.status === 'done') agg.done++;
    if (record.outcome.status === 'failed') agg.failed++;
    if (record.outcome.status === 'escalated') agg.escalated++;
    if (record.outcome.status === 'parked') agg.parked++;
    byKey.set(key, agg);
  }
  for (const agg of byKey.values()) {
    const decided = agg.done + agg.failed + agg.escalated;
    agg.successRate = decided >= minSamples ? agg.done / decided : null;
  }
  return [...byKey.values()].sort(
    (a, b) => a.loop.localeCompare(b.loop) || a.backend.localeCompare(b.backend),
  );
}

/** Compact run-report lines (0052) for job summaries / comments / the CLI. */
export function renderRunReport(records: readonly RunRecord[]): string[] {
  return records.map((r) => {
    const cost =
      (r.cost.routineRuns ? ` routineRuns=${r.cost.routineRuns}` : '') +
      (r.cost.usd ? ` usd=${r.cost.usd}` : '');
    return (
      `${r.loop} #${r.item.number} [${r.backend}] ${r.outcome.status}` +
      (r.outcome.transition ? ` (${r.outcome.transition})` : '') +
      (r.mode && r.mode !== 'act' ? ` mode=${r.mode}` : '') +
      cost
    );
  });
}
