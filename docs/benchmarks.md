# Benchmarks

Per-loop, per-provider **cost / latency / success** for the built-in loops,
folded from the run-record telemetry ledger by `loopdog bench`. Subscription
backends report quota + latency and **omit usd** (it's absent on a subscription,
not `$0`); only the self-hosted/API backend reports usd.

Regenerate the table below from a repo's ledger without touching this prose:

```bash
loopdog bench --since 30 --out docs/benchmarks.md      # splices between the markers
loopdog bench --format json --out bench.json           # machine-readable
```

<!-- loopdog:benchmarks -->
| loop | backend | n | success | p50 | p90 | quota | usd | usd/success |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| _(awaiting live numbers)_ | | | | | | | | |

_n = decided runs (done+failed+escalated); ⚠️ = below min_sample, low-confidence.
Subscription backends omit usd (—); self-hosted reports usd._
<!-- /loopdog:benchmarks -->

## Methodology

- **Source.** The numbers come from the run-record ledger on the `loopdog/telemetry`
  branch — the same append-only records the runner writes on every transition.
  `projectBenchmark` is pure and deterministic; `loopdog bench` only reads.
- **Success** = `done / (done + failed + escalated)` per `(loop, backend)`; a row
  below `--min-sample` (default 5) is flagged `⚠️` (low-confidence), never hidden.
- **Latency** = wall-clock from a run's first to last recorded step; reported as
  p50/p90 over the decided runs.
- **Quota** = effective dispatches in the window (what the subscription cap sees).
- **Cost.** usd is reported for self-hosted/API only; a subscription has no
  per-task usd, so the cell is `—` (absent), and a zero-success row never divides
  by zero.

## Published numbers

The committed table is populated from the **external dogfood** (task 0063) over a
stated window, with sample size + caveats recorded there. Until that live run is
performed by an operator, the table above is the schema + a placeholder — the
mechanism (`loopdog bench`) is verified offline against synthetic ledgers
(`packages/runtime/test/benchmark.test.ts`).
