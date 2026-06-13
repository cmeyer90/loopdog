import { describe, expect, it } from 'vitest';
import type { RunRecord } from '@looper/core';
import { projectBenchmark, renderBenchmarkMarkdown } from '@looper/runtime';

/**
 * Per-loop/provider benchmarks (M15 · 0065): fold the ledger into a stable
 * cost/latency/success report. Subscription rows omit usd; self-hosted reports
 * it; below-min-sample rows are flagged, not hidden; no NaN ever.
 */

const rec = (over: Partial<RunRecord> & { loop: string; backend: string }): RunRecord => ({
  runId: `run-${over.loop}-1-a0`,
  loop: over.loop,
  item: { owner: 'o', repo: 'r', number: 1 },
  trigger: { kind: 'cron', at: '2026-06-10T12:00:00Z' },
  backend: over.backend,
  steps: [
    { t: '2026-06-10T12:00:00.000Z', kind: 'dispatch', detail: 'go' },
    { t: '2026-06-10T12:00:02.000Z', kind: 'ingest', detail: 'completed' },
  ],
  outcome: { status: 'done' },
  cost: {},
  ...over,
});

describe('projectBenchmark (0065)', () => {
  it('computes success rate, p50/p90, and quota per (loop, backend)', () => {
    const records: RunRecord[] = [
      rec({ loop: 'implement', backend: 'claude', outcome: { status: 'done' } }),
      rec({ loop: 'implement', backend: 'claude', outcome: { status: 'done' } }),
      rec({ loop: 'implement', backend: 'claude', outcome: { status: 'failed' } }),
    ];
    const report = projectBenchmark(records, { minSample: 1 });
    const row = report.rows.find((r) => r.loop === 'implement' && r.backend === 'claude')!;
    expect(row.n).toBe(3);
    expect(row.successRate).toBeCloseTo(2 / 3);
    expect(row.quotaUse).toBe(3);
    expect(row.p50LatencyMs).toBe(2000);
    expect(row.usd).toBeUndefined(); // subscription → no usd
  });

  it('reports usd for self-hosted only, never NaN, and flags low-confidence', () => {
    const records: RunRecord[] = [
      rec({ loop: 'fix', backend: 'self-hosted', outcome: { status: 'done' }, cost: { usd: 0.5 } }),
    ];
    const report = projectBenchmark(records, { minSample: 5 });
    const row = report.rows[0]!;
    expect(row.lowConfidence).toBe(true); // 1 < 5
    expect(row.successRate).toBeNull(); // hidden until min sample, not NaN
    expect(row.usd).toBe(0.5);
    expect(row.usdPerSuccess).toBe(0.5);
    // A zero-success self-hosted row never divides by zero.
    const zero = projectBenchmark(
      [rec({ loop: 'x', backend: 'self-hosted', outcome: { status: 'failed' }, cost: { usd: 1 } })],
      { minSample: 1 },
    ).rows[0]!;
    expect(zero.usdPerSuccess).toBeUndefined();
    expect(Number.isNaN(zero.successRate ?? 0)).toBe(false);
  });

  it('renders a stable Markdown table with the low-confidence flag', () => {
    const md = renderBenchmarkMarkdown(
      projectBenchmark([rec({ loop: 'groom', backend: 'codex' })], { minSample: 5 }),
    );
    expect(md).toContain('| loop | backend |');
    expect(md).toContain('groom');
    expect(md).toContain('(!)'); // 1 sample < 5 → low-confidence flag
  });

  it('filters by --since / --loop / --backend', () => {
    const records = [
      rec({ loop: 'a', backend: 'claude', trigger: { kind: 'cron', at: '2026-01-01T00:00:00Z' } }),
      rec({ loop: 'b', backend: 'codex', trigger: { kind: 'cron', at: '2026-06-10T12:00:00Z' } }),
    ];
    const r = projectBenchmark(records, { since: '2026-06-01T00:00:00Z', loop: 'b' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.loop).toBe('b');
  });
});
