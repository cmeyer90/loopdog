# 0088 Failure Taxonomy & Classification

Status: verified  
Branch: task/0088-failure-taxonomy

## Goal

Replace the single "K failures → needs-human" heuristic with a **pure classifier**
that maps any failed transition into one of five failure classes —
`transient` · `terminal` · `poisoned` · `overload` · `budget` — each pointing at a
deterministic response (retry / escalate / quarantine / defer / pause). This is the
decision spine the resilience runner (0089/0090/0091) and the transition runner
(0012) consult; the sibling tasks implement the *effects*, this one owns the *map*.

## Background

Part of [Milestone 19](../milestones/milestone-19-resilience-and-failure-policy.md)
— its first Guiding Decision: *"A failure taxonomy drives the response."* See
[architecture](../../docs/architecture.md) "Resilience & failure policy" and
[codebase](../../docs/codebase.md) (`core` = pure domain: state machine, transition
decision logic, run-record types).

This generalizes the narrow stuck-detection predicate (M12 · 0051), which today
treats every failure identically (`++count → backoff → needs-human`). 0051 shaped
its `AttemptState`/`Decision` types *to be generalized here without a rewrite*; this
task wraps that predicate so the *kind* of failure selects the response rather than
one path serving all. It does **not** own retry timing (0089), concurrency/breaker
state (0090), or the config block + quarantine label + escalation routing (0091) —
it produces the classification those consume. Boundary with M17: this milestone owns
**unintentional/system** failures; deliberate **abuse** (untrusted actors, per-actor
caps) stays in M17 and is never classified here.

## Scope

- A closed `FailureClass` enum and a pure `classify(signal) → FailureClass` function
  over a normalized failure signal (the failing run-record `outcome` + attempt state
  + the backend's error/capability hints).
- A `responseFor(class, policy, attemptState) → Response` map: each class → a single
  deterministic response the runner can execute.
- A normalized `FailureSignal` the runtime builds from a failed step, so the
  classifier stays IO-free and unit-testable.
- The documented taxonomy table (class → trigger → response) under `docs/`.

### Technical detail

**Lands in `@loopdog/core`** (`core/src/resilience/` — alongside 0051's predicate;
pure, no IO). The runtime (`runtime/src/pipeline/`) builds the `FailureSignal` from a
failed step and acts on the returned `Response`; the runtime side is wired by
0089–0091, not here. No new IO port.

**The closed enum and the signal:**

```ts
type FailureClass =
  | 'transient'   // retry w/ backoff      → e.g. provider 5xx, network, timeout, rate-limit
  | 'terminal'    // escalate (no retry)   → e.g. invalid brief, repo gone, unrecoverable
  | 'poisoned'    // quarantine            → same item failed every prior attempt
  | 'overload'    // defer (no spend)      → too much in flight (max_in_flight)
  | 'budget';     // pause/park            → out of quota / over budget / kill-switch

type FailureSignal = {
  // from the failing run record (0012) — the source of truth for "why":
  outcome: { status: 'failed' | 'escalated'; step?: 'dispatch' | 'ingest' | 'gate' | string };
  backendError?: BackendError;       // optional structured error from the backend (0019)
  guard?: 'kill-switch' | 'budget' | 'quota' | 'circuit';  // set when a pre-flight GuardVerdict denied (0050/0075/0090)
  // from attempt state (0051), so the classifier can see history:
  attempt: { count: number; maxAttempts: number; everSucceeded: boolean };
  // from concurrency check (0090), so an over-ceiling deny classifies as overload:
  overCeiling?: boolean;
};
```

`BackendError` (a small discriminated union the execution-backend interface (0019)
already needs for `dispatch`/`ingest` errors) carries a `retryable: boolean` hint and
a coarse `kind` (`'provider-5xx' | 'rate-limit' | 'timeout' | 'invalid-input' |
'auth' | 'unknown'`). The classifier **uses the hint but is not bound by it** — see
precedence below.

**Classification precedence (first match wins, most specific → least):**

1. `guard` present → **`budget`** (a pre-flight *hold*, not a transition failure;
   never increments attempts — consistent with 0050's "parked, not failed").
2. `overCeiling` → **`overload`** (defer; also no attempt increment — a hold).
3. `backendError.kind ∈ {invalid-input, auth}` **or** a `terminal`-shaped outcome
   (e.g. brief/repo unrecoverable) → **`terminal`** (escalate immediately, do not
   burn the remaining attempt budget on a doomed item).
4. `attempt.count + 1 ≥ maxAttempts` **and** the failure was a genuine attempt →
   **`poisoned`** (it has now failed every allowed attempt → quarantine, distinct
   from `terminal` which is *known-unrecoverable on first sight*).
5. otherwise (`backendError.retryable`, 5xx, rate-limit, timeout, network, or
   unknown-but-attempts-remain) → **`transient`** (retry with backoff).

**The response map** (`responseFor`) returns a discriminated union the runner
executes — it carries *what to do*, not *how/when* (timing lives in 0089, label/route
in 0091):

```ts
type Response =
  | { kind: 'retry' }        // transient   → hand to backoff (0089); ++attempt
  | { kind: 'escalate' }     // terminal    → needs-human (0051 escalation edge); ++attempt
  | { kind: 'quarantine' }   // poisoned    → loopdog:quarantine (0091); record failure, no further retry
  | { kind: 'defer' }        // overload    → skip this tick, no spend (0090); no ++attempt
  | { kind: 'pause' };       // budget      → park / pause loop (0050/0075/0090); no ++attempt
```

`classify` and `responseFor` are total over the enum (a `switch` with no `default`,
so adding a class is a compile error until every site handles it). Both are pure and
take the policy (from `resilience:` config, loaded by 0091) as a parameter — this
task does **not** read config or GitHub.

**Attempt-counter contract (the load-bearing invariant):** only `retry` and
`escalate` (genuine transition failures) increment 0051's counter; `defer` and
`pause` are *holds* and must not, or a provider outage / budget window would burn the
human-attention budget. `quarantine` records the final failure but does not retry.
This keeps 0050's "parked, not failed" rule and 0051's "out-of-budget ≠ attempt"
guarantee intact under the new taxonomy.

**Edge cases:** (a) `backendError` absent (a bare failed step) → fall to rule 4/5 on
attempt count alone (fail toward `transient` while attempts remain — never silently
terminal). (b) `retryable: true` but attempts already exhausted → `poisoned`, not an
infinite retry (rule 4 precedes rule 5). (c) the dispatch-timeout / no-result path
(0073) arrives as a failed `dispatch` step with no `backendError` → classified
`transient` until attempts exhaust, matching 0051's note (c) that a no-PR provider
counts as a failed attempt, not a separate code path. (d) an ambiguous/unknown signal
with attempts remaining → `transient` (fail-open to *retry-with-backoff*, the
cheapest safe response), and the classifier returns the matched rule number for the
run record so a misclassification is debuggable.

## Out Of Scope

- Retry timing / `dispatch_timeout` / backoff schedule (0089).
- `max_in_flight` accounting + the circuit-breaker state machine (0090); this task
  only *names* `overload`/`transient` — 0090 decides when a streak trips the breaker.
- The `resilience:` config block, `loopdog:quarantine` label, `on_failure`/`escalate_to`
  routing, and CLI visibility (0091).
- Reading GitHub state or config, posting comments, mutating labels — all runtime
  effects, wired by 0089–0091.
- Defining `BackendError`'s full surface — that is the execution-backend interface
  (0019); this task consumes it and specifies only the fields it reads.

## Acceptance Criteria

- [x] A closed `FailureClass` enum + a pure `classify(signal, policy) → FailureClass`
      lands in `@loopdog/core` with no IO and a total `switch` (no `default`).
- [x] `responseFor` maps every class to exactly one deterministic `Response`, total
      over the enum.
- [x] Classification precedence is honored: guard→budget, overCeiling→overload,
      unrecoverable→terminal, last-attempt→poisoned, else→transient — proven by a
      table-driven test across every branch.
- [x] `defer` and `pause` responses do **not** increment the attempt counter; `retry`,
      `escalate`, and `quarantine`'s underlying failure do — asserted in tests.
- [x] An absent/unknown `backendError` with attempts remaining classifies `transient`
      (fail-open), never `terminal`; with attempts exhausted, `poisoned`.
- [x] The taxonomy table (class → trigger → response) is documented under `docs/`.
- [x] `pnpm -F @loopdog/core test` passes.

## Implementation Checklist

- [x] Define `FailureClass`, `FailureSignal`, `Response` types in
      `core/src/resilience/` (extending 0051's `AttemptState`/`Decision`, not forking).
- [x] Implement `classify` with the documented precedence as a total `switch`.
- [x] Implement `responseFor` and the attempt-increment contract helper.
- [x] Specify the `FailureSignal`-build contract the runtime (0089–0091) implements
      (a typed builder signature in `core`, called from `@loopdog/runtime`).
- [x] Add the taxonomy doc table under `docs/` (cross-link from the M19 milestone).
- [x] Table-driven unit tests over every class + precedence boundary.

## Test Plan

Tests run via the repo's vitest runner; this task is pure `@loopdog/core` decision
logic, so tests are IO-free unit tests — no M18 fakes or backend, no real quota.

```bash
pnpm -F @loopdog/core test
#  - guard set → budget; overCeiling → overload; auth/invalid-input → terminal
#  - count+1 == maxAttempts → poisoned; retryable 5xx w/ attempts left → transient
#  - retryable but exhausted → poisoned (precedence), not infinite retry
#  - absent backendError + attempts left → transient (fail-open), not terminal
#  - responseFor totality: every FailureClass → exactly one Response
#  - increment contract: defer/pause do not ++; retry/escalate do
```

## Verification Log

- 2026-06-12: taxonomy green (`packages/core/test/resilience.test.ts`, table-
  driven): `classify` honors the precedence spend→ceiling→terminal→poisoned→
  transient across every branch; `responseFor` is total (5 classes → retry/
  escalate/quarantine/defer/pause via an exhaustive `switch`, no `default`);
  `incrementsAttempt` is true for retry/escalate/quarantine and false for defer/
  pause; fail-open proven (absent/recoverable error with attempts remaining →
  transient, exhausted → poisoned). The runtime consumes it in the dispatch-
  failure + dispatch-timeout paths (`transition-runner.ts`); the class→trigger→
  response table is documented at `docs/resilience.md`.

## Decisions

- `FailureClass` reuses the run-record enum (`transient | terminal | poisoned |
  overload | budget`) as the single source of truth. The classifier lives at
  `packages/core/src/resilience/taxonomy.ts` (pure, no IO).
- The realized `FailureSignal` is leaner than the task's sketch — `{ spendDenied,
  overCeiling, backendError?: {recoverable}, attempts, maxAttempts }` — but
  captures the same precedence inputs (a spend-gate deny, an over-ceiling deny,
  an unrecoverable provider error, the attempt count). The richer `outcome`/
  `BackendError.kind`/`guard`-enum shape from the sketch collapsed to those
  booleans/fields the runtime actually supplies.
- Precedence (first match wins, total): spendDenied → `budget`; overCeiling →
  `overload`; `backendError.recoverable === false` → `terminal`; `attempts ≥
  maxAttempts` → `poisoned`; else → `transient` (fail-open — an absent/unknown
  error never classifies `terminal`).
- Attempt-increment contract: `retry`/`escalate`/`quarantine` increment (a real
  failure), `defer`/`pause` do NOT (holds, not the item's fault) — so an overload
  or budget pause never silently exhausts an item.

## Risks / Rollback

- **Misclassification cascade:** calling a `terminal` failure `transient` wastes a
  whole retry budget on a doomed item; calling a `transient` `terminal` escalates
  flaky-but-recoverable work to a human. Mitigate with the table-driven test across
  every boundary and by recording the matched rule number in the run record so a
  bad call is traceable. Precedence (terminal before poisoned before transient) is
  the safeguard — keep it pure and exhaustively tested.
- **Drift from 0051's counter:** if `defer`/`pause` ever increment attempts, a
  provider outage or budget window silently exhausts items. The increment-contract
  test is the guard; it must stay green.
- Rollback: additive and pure. Until 0089–0091 wire the runtime to `responseFor`,
  the existing 0051 path is unchanged; reverting this task removes only the unused
  classifier.

## Final Summary

A pure, total classifier maps any failed/pre-empted transition into one of five
failure classes by a fixed precedence, and each class maps to exactly one
response (retry/escalate/quarantine/defer/pause) with a clear attempt-increment
contract. It fails open to `transient` (never a false `terminal`), reuses the
run-record `FailureClass` enum, and is the decision spine 0089/0090/0091 + the
transition runner consult. Table-driven tests cover every branch; the taxonomy
table is in `docs/resilience.md`.
