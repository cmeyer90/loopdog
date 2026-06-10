# 0065 Cost & Latency Benchmarks

Status: planned  
Branch: task/0065-cost-latency-benchmarks

## Goal

Produce per-loop, per-provider **cost / latency / success** benchmarks for the
four built-in loops on real Claude and Codex subscriptions, and **publish the
numbers** — a reproducible `looper bench` command that folds the existing
telemetry ledger into a stable report (Markdown + JSON), plus a committed
`docs/benchmarks.md` table the quickstart and routing defaults can cite.

## Background

Part of [Milestone 15](../milestones/milestone-15-v1-hardening-and-release.md):
the Definition-of-Done requires "cost/latency/success benchmarks are published,"
and the milestone gates `1.0.0` on proving looper on a real external repo. This
task is the measurement half of that proof — it runs on the same dogfood repo as
0063 and feeds honest numbers into the docs (0058) and the cost/quality routing
config (M13 · 0057/0056).

It is a **thin aggregator + publisher over data that already exists**: the
transition runner emits one run record per attempt (M03 · 0012) with `cost`,
`backend`, and step timestamps; per-provider outcome telemetry (M12 · 0053)
already folds those records into a per-loop × per-provider `ProviderLedger` with
`success_rate`, p50/p90 `latency_ms`, summed `cost`, and `failure_modes`. This
task does **not** define new storage or a new aggregate — it adds a benchmark
*projection* of that ledger, a CLI surface to render it, and the published
artifact. See [architecture](../../docs/architecture.md#observability-cost--safety)
("Per-provider outcome telemetry feeds routing") and
[codebase](../../docs/codebase.md) ("Testing strategy" — five-tier pyramid; the
M18 fakes make this provable offline). GitHub is the only store — **no database**.

## Scope

- A pure **benchmark projection** in `@looper/core` that turns a `ProviderLedger`
  (0053) over a window into a flat, publishable `BenchmarkReport` (per loop ×
  provider: n, success rate, p50/p90 latency, cost-per-success, quota use,
  failure-mode mix), with both a Markdown table and a stable JSON shape.
- A `looper bench` CLI command (`@looper/cli`) that reads the telemetry ledger,
  renders the report to stdout / a file, and supports `--since`, `--loop`,
  `--backend`, and `--format md|json`.
- A committed, version-controlled **`docs/benchmarks.md`** with the published
  numbers + a "how these were measured" methodology section (repo, window, sample
  size, date, provider tiers, caveats), linked from the docs site (0058).
- A **methodology** that is honest about subscription paths: report **usd only
  for the self-hosted/API backend** (subscription paths have no per-token dollar
  figure); for Claude/Codex report **quota use** (`routine_runs`, cloud-task
  count) and **wall-clock latency** as the cost proxies.
- A small, reproducible **benchmark scenario suite** (M18) that produces a
  deterministic baseline report from recorded cassettes, so CI can assert the
  report shape and the publish path without spending quota.

### Technical detail

**Lands in:** the pure projection + types in `@looper/core`
(`core/src/run-record/benchmark.ts`, beside `ledger.ts` from 0053, re-exported
from the barrel); the CLI command in `@looper/cli`
(`cli/src/commands/bench.ts`); the published doc in `docs/benchmarks.md`; the
deterministic baseline scenario in `@looper/testing`. **No new package, no new IO
port, no new store** — it consumes `TelemetrySink.ledger(window)` /
`TelemetrySink.query(...)` (0053) via the runtime the CLI already wires.

**Benchmark projection (`@looper/core`)** — a pure fold over the ledger cells:

```ts
type BenchRow = {
  loop: string;
  backend: 'claude' | 'codex' | 'self-hosted';
  n: number;                                  // attempts in window
  success_rate: number;                       // done / (done+failed+escalated)
  merge_rate?: number;                         // PRs merged / opened, when derivable
  latency_ms: { p50: number; p90: number };    // dispatch→ingest wall time (0053 def)
  quota: { routine_runs?: number; cloud_tasks?: number };  // subscription cost proxy
  usd?: number;                                // self-hosted/API only; absent for subs
  cost_per_success?: { usd?: number; quota?: number };     // usd|quota ÷ done
  failure_modes: Record<string, number>;       // ci-red, no-result, review-rejected, …
};
type BenchmarkReport = {
  generated_at: string; window: string; repo: string; sample_size: number;
  rows: BenchRow[];                            // sorted (loop, backend)
};
function projectBenchmark(ledger: ProviderLedger, meta: { repo: string }): BenchmarkReport;
function renderBenchmarkMd(r: BenchmarkReport): string;   // the docs table
```

`projectBenchmark` is deterministic and IO-free — it only re-shapes the 0053
`Cell[]` (adds `cost_per_success`, drops cells where `n < min_sample`). Cells with
`n=0` are already omitted by 0053; cells below a `min_sample` threshold are marked
*low-confidence* in the rendered table (not hidden) so a thin sample is visible,
not silently dropped. Latency reuses the **dispatch→ingest** definition from 0053
(do not redefine it).

**`looper bench` (`@looper/cli`):**

```
looper bench [--since 30d] [--loop implement] [--backend claude]
             [--format md|json] [--out docs/benchmarks.md]
```

Calls `TelemetrySink.ledger(window)` (filtered by `--loop`/`--backend`),
`projectBenchmark`, then `renderBenchmarkMd` (default) or `JSON.stringify` the
report. `--out` writes the file (used to regenerate `docs/benchmarks.md`); no
`--out` writes stdout. The command is **read-only** over telemetry — it never
dispatches, claims, or mutates GitHub state, so running it costs nothing.

**Published artifact (`docs/benchmarks.md`):** the rendered Markdown table plus a
hand-written **Methodology** block: the dogfood repo + window + run date, sample
size per cell, provider subscription tiers used, and the explicit caveats — (a)
subscription paths report quota/latency, **not dollars**; (b) numbers reflect one
real repo over a bounded window and are **indicative, not a benchmark suite**; (c)
Claude routines are beta and Codex cloud is rate-capped (~5 tasks/hr), so latency
includes queueing under caps. This file is checked in and regenerated by
`looper bench --out docs/benchmarks.md`; the surrounding prose is preserved by
writing only between stable `<!-- looper:benchmarks -->` … `<!-- /looper:benchmarks -->`
markers.

**Measurement run (against 0063's dogfood).** Benchmarks are computed from the
telemetry the dogfood (0063) already accumulated — no separate "benchmark mode."
The task documents the procedure: run the four loops on the dogfood repo over a
representative window, let 0053 persist records to the `looper/telemetry` branch,
then `looper bench --since <window>` against that repo. No quota is spent by the
benchmark itself; it reads the ledger.

**Edge cases:** (a) empty/sparse ledger (no dogfood data yet) → emit a report with
zero rows and a clear "insufficient data" note, never `NaN`/divide-by-zero (reuse
0053's n=0 omission + the `min_sample` low-confidence flag); (b) a backend with no
usd reporting → `usd`/`cost_per_success.usd` **absent**, not `0`, so the doc never
implies a subscription path is "$0" (mirrors 0053 edge-case e); (c) clock skew →
buckets come from record timestamps via 0053, not wall-clock-at-render; (d)
mixed-provider loop (routing split a loop across providers) → one row per
(loop, backend) pair, not a merged average that hides the split; (e) the rendered
table under test uses the M18 deterministic clock/seeds so the golden snapshot is
stable.

## Out Of Scope

- The telemetry store, the `ProviderLedger` aggregate, the latency definition, and
  failure-mode bucketing (all M12 · 0053) — this task projects and publishes them.
- The run-record schema and its `cost` fields (M03 · 0012).
- Budget/quota *enforcement* (0050/0075) — benchmarks observe cost, they don't gate.
- The routing *policy* that consumes the numbers (M13 · 0056/0057) — this supplies data.
- The dogfood run itself (0063) and the security review (0064) — sibling M15 tasks.
- A continuous/regression benchmark CI job or a hosted dashboard (post-V1).

## Acceptance Criteria

- [ ] `projectBenchmark` turns a `ProviderLedger` into a `BenchmarkReport` with one
      row per (loop, backend): n, success rate, p50/p90 latency, quota use, and (for
      self-hosted only) usd + cost-per-success — deterministic and IO-free.
- [ ] Subscription rows report quota + latency and **omit** usd (absent, not `0`);
      self-hosted rows report usd; a row below `min_sample` is flagged low-confidence,
      not hidden; a divide-by-zero never produces `NaN`.
- [ ] `looper bench` renders the report to stdout (md default) and to a file via
      `--out`, honoring `--since`/`--loop`/`--backend`/`--format`, and never mutates
      GitHub or dispatches.
- [ ] `docs/benchmarks.md` exists, contains the rendered table between the
      `looper:benchmarks` markers plus a Methodology section, and is regenerable by
      `looper bench --out docs/benchmarks.md` without clobbering the prose.
- [ ] Published numbers are sourced from the 0063 dogfood telemetry over a stated
      window, with sample size and caveats recorded.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add `BenchRow`/`BenchmarkReport` + `projectBenchmark`/`renderBenchmarkMd` in
      `@looper/core` (`core/src/run-record/benchmark.ts`), re-exported from the barrel.
- [ ] Implement `looper bench` in `@looper/cli` over `TelemetrySink.ledger/query`,
      with `--since/--loop/--backend/--format/--out` and marker-bounded file write.
- [ ] Add a deterministic baseline scenario in `@looper/testing` (recorded cassette
      → fixed ledger → golden report) for offline CI.
- [ ] Write `docs/benchmarks.md` (table between markers + Methodology) and link it
      from the docs site nav (0058).
- [ ] Run the loops on the 0063 dogfood repo, then generate + commit the published
      numbers; record window/sample/date/tiers in the methodology block.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral paths use the M18 fakes
(in-memory GitHub + fake backend + deterministic clock/seeds) — **no real quota**.

```bash
pnpm vitest run packages/core packages/cli
# unit (core, IO-free, snapshot):
#   projectBenchmark — mixed done/failed/escalated ledger → per-(loop,backend) rows,
#     success_rate, p50/p90, cost_per_success; subscription row omits usd (not 0);
#     n<min_sample flagged low-confidence; n=0 cell absent; no NaN.
#   renderBenchmarkMd — golden Markdown table.
# scenario (fake GitHub + recorded cassette):
#   looper bench --format json → report matches the fixture ledger.
#   looper bench --out tmp.md  → writes only between the markers, preserves prose;
#     command performs zero dispatches / zero GitHub mutations.
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the `BenchmarkReport` JSON shape (the stable published contract); the
`min_sample` low-confidence threshold; the usd-only-for-self-hosted policy and how
quota stands in as the subscription cost proxy; the marker-bounded
`docs/benchmarks.md` regeneration scheme; and the measurement window/repo used for
the published `1.0.0` numbers.

## Risks / Rollback

- **Dishonest numbers** are the sharp risk: reporting a subscription path as "$0"
  or averaging across providers would mislead adopters and routing. The usd-absent
  (not-`0`) rule, the per-(loop, backend) split, and the explicit Methodology
  caveats are mandatory, guarded by the unit test.
- **Thin sample** from a single dogfood window over-claims precision — the
  `min_sample` low-confidence flag + recorded sample size keep the report honest;
  the numbers are labelled indicative, not a benchmark suite.
- This task is additive and read-only over telemetry (0053) — it never gates a
  loop. Rollback: drop `docs/benchmarks.md` and the `bench` command; the control
  loop is unaffected. If 0053 telemetry is unavailable at `1.0.0`, ship the command
  + methodology with a "data pending first dogfood" note rather than blocking release.

## Final Summary

Fill this in before marking verified.
