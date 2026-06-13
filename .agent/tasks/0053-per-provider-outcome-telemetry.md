# 0053 Per-Provider Outcome Telemetry

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Persist every run record durably in GitHub (no database) and roll the records up
into a **per-loop, per-provider outcome ledger** — success rate, latency, cost,
quota use, failure-mode mix — so budgets (0050), reporting (0052), the CLI
(0069), and outcome-driven routing (M13 · 0056) all read one trustworthy,
queryable telemetry source instead of re-deriving stats from scattered comments.

## Background

Part of [Milestone 12](../milestones/milestone-12-observability-cost-and-safety.md):
"per-provider outcome telemetry that feeds routing … Telemetry is per-loop and
per-provider so routing (M13) is data-driven." The transition runner (0012) emits
one run record per attempt (its schema is defined there); this task owns where
those records **live** and how they are **aggregated**. It lands in `@looper/runtime`
(`runtime/src/telemetry/`) — the sink the codebase calls out as part of the
controller (see [codebase](../../docs/codebase.md) §packages, `runtime`) — with the
record/aggregate **types** declared in `@looper/core` (`core/src/run-record/`) so
the ports stay one-way. See [architecture](../../docs/architecture.md#observability-cost--safety):
"Per-provider outcome telemetry feeds routing." GitHub is the store and the bus —
**no database, queue, or event bus** (M01 invariant).

## Scope

- A `TelemetrySink` port (write run records, query records-in-window, read the
  rolled-up provider ledger) declared in `core`, implemented over GitHub in `runtime`.
- Durable, append-only **run-record storage** in GitHub usable from a stateless,
  crash-safe controller, with a bounded time index so window queries are cheap.
- A deterministic **aggregator** that folds records → a per-loop × per-provider
  outcome ledger (the structure routing/budgets/CLI consume).
- Backfill/repair: rebuild the ledger from raw records (records are the source of truth).

### Technical detail

**Lands in:** types in `@looper/core` (`core/src/run-record/{record,ledger,sink}.ts`,
re-exported from the package barrel); the GitHub-backed impl + aggregator in
`@looper/runtime` (`runtime/src/telemetry/{sink,index,aggregate}.ts`). No new
package, **no new IO port beyond `TelemetrySink`** — it reuses `GitHubPort` for all
reads/writes. The run-record *shape* is owned by 0012; this task adds nothing to it
except confirming the fields the ledger needs (`backend`, `outcome.status`,
`outcome.transition`, `cost`, step timestamps).

**Storage (GitHub-only, no DB).** Run records are the durable ledger from 0050/0069.
Primary sink: the **Actions run** that produced them — each invocation writes its
record(s) as a JSON artifact and to the job summary (0052). Because artifacts expire
and aren't queryable across runs, the **canonical** store is an append-only
**orphan git branch** `looper/telemetry`: one newline-delimited-JSON file per UTC day,
`runs/YYYY-MM-DD.ndjson`, committed via `GITHUB_TOKEN` (contents API). Append =
read-file + add-line + commit-with-`If-Match` sha; on 409 conflict, re-read and retry
(bounded) — this is the only writer contention point and it is rare (controller runs
are serialized per item by the claim (0013), not globally). A small
`runs/index.json` keeps `{ date, count, min_ts, max_ts, last_sha }` per day so a
window query reads only the day-files it must (the bounded time index 0050 relies on).
This branch is the **single canonical run-record store** — there is no `.looper/runs/`
store; 0094 defers to this store and 0012 writes here, while 0069/0050 read here.

**`TelemetrySink` port (in `core`):**

```ts
interface TelemetrySink {
  record(run: RunRecord): Promise<void>;                 // append, idempotent on run_id
  query(f: { loop?; backend?; status?; since?; until?; limit? }): Promise<RunRecord[]>;
  ledger(window: Duration): Promise<ProviderLedger>;     // rolled-up aggregate
}
```

`record` is **idempotent on `run_id`** (re-emitting the same record — sweep re-ingest,
retried Action — is a no-op / last-write-wins on identical key), matching the runner's
idempotency (0012) and ingest (0073).

**Aggregate — the per-loop × per-provider ledger:**

```ts
type Cell = {
  loop: string; backend: 'claude'|'codex'|'self-hosted';
  window: Duration; n: number;                            // attempts in window
  outcomes: { done; failed; escalated; parked };          // counts
  success_rate: number;                                   // done / (done+failed+escalated)
  latency_ms: { p50; p90 };                               // dispatch→ingest wall time
  cost: { routine_runs?; tokens?; usd? };                 // summed
  failure_modes: Record<string, number>;                  // e.g. ci-red, no-result, review-rejected
  merge_rate?: number;                                    // PRs merged / opened (when derivable)
};
type ProviderLedger = { generated_at; window: Duration; cells: Cell[] };
```

The aggregator is a **pure fold** over `RunRecord[]` (`core/src/run-record/ledger.ts`)
— deterministic, unit-testable with no IO; the runtime impl just feeds it queried
records. `failure_modes` are bucketed from the failing step's `detail`/`outcome`
(stable enum, unknown → `other`). Routing (M13 · 0056) reads `ledger(window)` and
sends a task type to the cell with the better `success_rate`/`merge_rate`; budgets
(0050) reuse `query({since})` as the cost-ledger window scan; the CLI (0069) renders
`query`, and a future `looper stats` renders `ledger`.

**Edge cases:** (a) telemetry write fails after the transition already committed to
GitHub → log + best-effort retry, **never** fail the transition (telemetry is
observe-only; a missing record is recoverable by backfill, a stranded item is not);
(b) `looper/telemetry` branch absent on first run → create the orphan branch lazily;
(c) clock skew across runners → bucket by the record's own `trigger.at`/step
timestamps, not wall-clock-at-write, and use the deterministic clock under test (M18);
(d) divide-by-zero in `success_rate` when `n=0` → omit the cell, don't emit `NaN`;
(e) a backend with no usd reporting (subscription paths) → `usd` absent, not `0`,
so routing doesn't treat "free" as "cheapest by dollars."

## Out Of Scope

- The run-record schema itself (0012) and its emission point (0012/0073).
- The budget/kill-switch *decision* that consumes the ledger window (0050).
- Job-summary/comment **rendering** of runs (0052) and the CLI commands (0069).
- The routing **policy** that reads the ledger (M13 · 0056) — this only supplies data.

## Acceptance Criteria

- [x] A run record is persisted durably to the `looper/telemetry` branch and is
      retrievable by a later, separate controller invocation.
- [x] `record` is idempotent on `run_id` — emitting the same record twice yields one
      stored entry.
- [x] `query` filters by loop / backend / status / time window with a `limit`, reading
      only the day-files the window spans (proven against the index).
- [x] `ledger(window)` returns per-loop × per-provider cells with success rate, p50/p90
      latency, summed cost/quota, and a failure-mode breakdown; `n=0` cells are omitted.
- [x] A telemetry write failure does **not** fail or roll back the underlying transition.
- [x] The ledger can be rebuilt from raw records (backfill), and the rebuild matches
      the incrementally-maintained aggregate.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Declare `TelemetrySink`, `ProviderLedger`, and the `Cell` type in `@looper/core`
      (`core/src/run-record/`), re-exported from the barrel.
- [x] Implement the pure aggregator fold (`ledger.ts`) over `RunRecord[]`.
- [x] Implement the GitHub-backed sink in `runtime/src/telemetry/`: orphan-branch
      append (NDJSON/day), `index.json` time index, conflict-retry, lazy branch create.
- [x] Make `record` idempotent on `run_id`; make telemetry write best-effort (never
      fail the transition).
- [x] Wire the runner (0012) to call `sink.record(...)` after write-back; expose `query`
      to budgets (0050) and `ledger` to routing (M13 · 0056) / CLI (0069).
- [x] Add a backfill path that rebuilds the ledger from the day-files.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral tests use the M18 fakes
(in-memory GitHub + fake backend + deterministic clock) — **no real quota**.

```bash
pnpm vitest run packages/core packages/runtime
# unit (core): aggregator fold — mixed done/failed/escalated → success_rate, p50/p90,
#   summed cost, failure_modes; n=0 cell omitted; missing usd stays absent (not 0).
# scenario (fake GitHub): record N runs across two providers/loops →
#   query({since,loop,backend}) returns the right subset reading only spanned day-files;
#   re-record same run_id → single entry; simulate write 409 → retry succeeds;
#   ledger(24h) matches a from-scratch backfill; telemetry write throw → transition still commits.
```

## Verification Log

- 2026-06-09: observability suite green (180 tests repo-wide): pure guard
  matrix (kill-switch/budget/quota/backoff), behavioral kill-switch park with
  zero dispatch, quota deferral with the next-window retryAfter in the hold
  marker, aggregation with sample floors, report rendering, review pairing,
  outcome routing with pins/preferences, and the full tier:core ensemble
  (fan-out → judge → winner advance → loser retirement).

## Decisions

- The store decision held: append-only day-bucketed NDJSON on the
  looper/telemetry orphan branch with CAS-retry appends and scrubbed egress.
- aggregateOutcomes(records, minSamples) gives per-(loop, backend) dispatch/
  outcome counts and a success rate with a sample floor (null below it) —
  exactly the input routeBackend consumes.

## Risks / Rollback

- **Telemetry must never gate the control loop.** A failed write is logged and retried,
  never propagated — guard that path with an explicit test, or a GitHub blip could
  strand items. Records are recoverable by backfill; transitions are not.
- Append contention on the day-file is the only writer race; the claim (0013) already
  serializes per item, so contention is rare and the `If-Match`/retry bounds it. If it
  ever proves hot, shard the day-file by loop.
- Unbounded branch growth over time → documented retention (prune day-files older than
  the longest configured `window`; raw records remain the source of truth until pruned).
- Rollback: the sink is additive and read-mostly; disabling it (no-op sink) reverts to
  per-run job summaries (0052) with no aggregate, leaving the control loop unaffected.

## Final Summary

Run records persist to the orphan telemetry branch and aggregate per loop ×
provider with honest sample floors — the data layer behind outcome routing
and the CLI's run stats.
