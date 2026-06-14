import type { RunRecord } from '@loopdog/core';

/**
 * Per-loop, per-provider benchmarks (task 0065): fold the run-record ledger into
 * a stable cost / latency / success report - one row per (loop, backend). Pure,
 * IO-free, deterministic. Subscription backends report quota + latency and OMIT
 * usd (it's absent on a subscription, not `0`); only self-hosted reports usd.
 */

export interface BenchmarkRow {
  loop: string;
  backend: string;
  /** Decided runs = done + failed + escalated (the success denominator). */
  n: number;
  successRate: number | null; // null when n < minSample (low-confidence)
  lowConfidence: boolean;
  p50LatencyMs: number | null;
  p90LatencyMs: number | null;
  /** Dispatches counted toward provider quota in the window. */
  quotaUse: number;
  /** Self-hosted only: total usd + usd/success; absent (undefined) for subscriptions. */
  usd?: number | undefined;
  usdPerSuccess?: number | undefined;
}

export interface BenchmarkReport {
  since?: string | undefined;
  until?: string | undefined;
  minSample: number;
  rows: BenchmarkRow[];
}

export interface BenchmarkOptions {
  minSample?: number;
  since?: string | undefined;
  until?: string | undefined;
  /** Restrict to one loop / backend. */
  loop?: string | undefined;
  backend?: string | undefined;
  /** Backends billed in usd (self-hosted/API); others are subscription (no usd). */
  usdBackends?: readonly string[];
}

/** A run's wall-clock latency from its first to last step (ms), if derivable. */
function latencyMs(r: RunRecord): number | null {
  if (r.steps.length < 2) return null;
  const first = Date.parse(r.steps[0]!.t);
  const last = Date.parse(r.steps[r.steps.length - 1]!.t);
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) return null;
  return last - first;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** Build the benchmark report from a ledger (deterministic; never produces NaN). */
export function projectBenchmark(
  records: readonly RunRecord[],
  opts: BenchmarkOptions = {},
): BenchmarkReport {
  const minSample = opts.minSample ?? 5;
  const usdBackends = new Set(opts.usdBackends ?? ['self-hosted']);
  const sinceMs = opts.since ? Date.parse(opts.since) : -Infinity;
  const untilMs = opts.until ? Date.parse(opts.until) : Infinity;

  const buckets = new Map<
    string,
    {
      loop: string;
      backend: string;
      latencies: number[];
      done: number;
      decided: number;
      quota: number;
      usd: number;
    }
  >();

  for (const r of records) {
    const at = Date.parse(r.trigger.at);
    if (at < sinceMs || at > untilMs) continue;
    if (opts.loop && r.loop !== opts.loop) continue;
    if (opts.backend && r.backend !== opts.backend) continue;
    const key = `${r.loop} ${r.backend}`;
    const b = buckets.get(key) ?? {
      loop: r.loop,
      backend: r.backend,
      latencies: [],
      done: 0,
      decided: 0,
      quota: 0,
      usd: 0,
    };
    if (r.steps.some((s) => s.kind === 'dispatch' && !s.detail.startsWith('failed'))) b.quota++;
    const status = r.outcome.status;
    if (status === 'done' || status === 'failed' || status === 'escalated') {
      b.decided++;
      if (status === 'done') b.done++;
      const lat = latencyMs(r);
      if (lat !== null) b.latencies.push(lat);
    }
    b.usd += r.cost.usd ?? 0;
    buckets.set(key, b);
  }

  const rows: BenchmarkRow[] = [...buckets.values()]
    .map((b) => {
      const sorted = [...b.latencies].sort((x, y) => x - y);
      const lowConfidence = b.decided < minSample;
      const isUsd = usdBackends.has(b.backend);
      const row: BenchmarkRow = {
        loop: b.loop,
        backend: b.backend,
        n: b.decided,
        successRate: lowConfidence || b.decided === 0 ? null : b.done / b.decided,
        lowConfidence,
        p50LatencyMs: percentile(sorted, 50),
        p90LatencyMs: percentile(sorted, 90),
        quotaUse: b.quota,
      };
      if (isUsd) {
        row.usd = b.usd;
        row.usdPerSuccess = b.done > 0 ? b.usd / b.done : undefined;
      }
      return row;
    })
    .sort((a, b) => a.loop.localeCompare(b.loop) || a.backend.localeCompare(b.backend));

  return {
    minSample,
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.until ? { until: opts.until } : {}),
    rows,
  };
}

const ms = (v: number | null): string => (v === null ? '-' : `${Math.round(v)}ms`);
const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);

/** Render the report as a Markdown table (the committed docs/benchmarks.md body). */
export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines = [
    `| loop | backend | n | success | p50 | p90 | quota | usd | usd/success |`,
    `|---|---|--:|--:|--:|--:|--:|--:|--:|`,
  ];
  for (const r of report.rows) {
    const flag = r.lowConfidence ? ' (!)' : '';
    lines.push(
      `| ${r.loop} | ${r.backend} | ${r.n}${flag} | ${pct(r.successRate)} | ${ms(r.p50LatencyMs)} | ` +
        `${ms(r.p90LatencyMs)} | ${r.quotaUse} | ${r.usd === undefined ? '-' : '$' + r.usd.toFixed(2)} | ` +
        `${r.usdPerSuccess === undefined ? '-' : '$' + r.usdPerSuccess.toFixed(2)} |`,
    );
  }
  lines.push('');
  lines.push(
    `_n = decided runs (done+failed+escalated); (!) = below min_sample (${report.minSample}), ` +
      `low-confidence. Subscription backends omit usd (-); self-hosted reports usd._`,
  );
  return lines.join('\n');
}
