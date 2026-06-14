# End-to-End Dogfood Report (task 0063)

The V1 integration gate: Loopdog attached to ≥1 real **externally-owned** repo on
real **Claude + Codex** subscriptions, driving real issues groom → implement →
review → merge (→ deploy), human-gated at merge.

> **Status: operator-pending.** A live external dogfood on real subscriptions
> cannot be performed by an offline agent (it needs a real repo, real provider
> auth, and real quota). This document is the **runbook + the report template**
> an operator fills in to close the gate. Until then, the offline harness below
> stands in as the structural proxy.

## The offline proxy (what's proven now)

The full machinery is exercised end-to-end on the in-memory fakes, zero quota:

- the four loops run a raw issue → deployed (`packages/runtime/test/loops-e2e.test.ts`);
- the committed example attachment validates + runs groom→implement to a golden
  (`packages/testing/test/example-node-todo.test.ts`, `examples/node-todo/`);
- the M18 simulation provokes the edge cases (dropped webhook, event↔sweep race,
  no-PR timeout, duplicate, crash) and asserts the invariants
  (`packages/testing/test/simulation.test.ts`);
- M17/M19 cover the untrusted-trigger, scope-exceed, and timeout paths.

These prove the *logic* faithfully; the live run proves the *provider reality*
(routine API drift, real correlation timing, real CI) the fakes can only
approximate — which is exactly what the tier-5 live smoke (0087) + this dogfood
are for.

## Runbook (operator)

1. Attach Loopdog to a real external repo via the documented flow
   ([quickstart](../quickstart.md)) — Claude routine import **and** Codex App.
2. Open ≥1 real issue; drive it groom → implement → review → merge (human-gated).
3. Ensure **both** providers each merge ≥1 issue, and a cross-provider review
   runs in both directions (Codex on a Claude PR and vice-versa).
4. Confirm `test:` criteria gate merge (rung 2 CI) and `manual:` criteria are
   intent-diff checked (0043).
5. Run deploy + smoke on ≥1 merge where deployable (or file the gap).
6. Provoke each edge case (dropped webhook, race, no-PR timeout, untrusted
   trigger, scope-exceed, under-groomed) and confirm spec behavior.
7. Bound the run with budgets/quota; the repo's own test suite spends **no**
   subscription quota — the dogfood run is the only live spend.

## Per-issue traces

_Fill from real run records (`loopdog runs show <id>` / the telemetry ledger)._

| Issue | Provider | Path | Outcome | Run records | Notes |
|---|---|---|---|---|---|
| _#_ | claude/codex | groom→…→merge | done/escalated | _link_ | |

## Aggregate

_From `loopdog bench` over the dogfood window (feeds [benchmarks.md](../benchmarks.md))._

## Bug ledger

| # | Severity | Symptom | Disposition (PR / follow-up task) |
|---|---|---|---|

## Go / No-Go

- [ ] Both providers merged ≥1 issue; cross-provider review ran both directions.
- [ ] Every blocking defect fixed (PR linked) or filed with severity.
- [ ] No quota spent outside the bounded dogfood run.
- [ ] **Verdict:** _go / no-go_ — _operator signs off here._
