# 0084 Fake & Replay Backends

Status: verified  
Branch: task/0084-fake-and-replay-backends

## Goal

A scripted in-memory fake `Backend` plus a record-once/replay cassette backend for
Claude and Codex, so whole loops run through the real `dispatch → ingest` split
offline, deterministically, and with **zero subscription quota** spent.

## Background

Part of [Milestone 18](../milestones/milestone-18-test-and-simulation-harness.md)
(tier-2 component conformance + the backend half of tier-3 scenarios). Pairs with
the fake GitHub (0083): the fake GitHub provides the bus, these provide the
provider side. Because `Backend` is a port interface in `@looper/core`
(0019 — `capabilities`/`dispatch`/`ingest`), a fake is a drop-in the runner (M03 ·
0012) can't tell from the real `claude`/`codex` impls (0020/0021). Lands in the
dev-only `@looper/testing` package (`testing/src/fake-backends/`). See
[codebase](../../docs/codebase.md) "Testing strategy" and
[architecture](../../docs/architecture.md) "Execution model."

## Scope

- A **scripted fake backend** implementing `Backend` over in-memory state: declared
  `capabilities()`, a `dispatch` that records the call and (via the fake GitHub)
  synthesizes the provider's out-of-band PR, and a real `ingest` that exercises the
  correlation path (0073).
- A **replay (cassette) backend**: record-once against a real provider, replay the
  recorded `dispatch`/`ingest` exchange deterministically in CI.
- A **conformance suite** every `Backend` (fake, replay, and the real 0020/0021)
  must pass, so the fakes stay faithful to the contract.

### Technical detail

**Package / files** (`@looper/testing`, dev-only):
`testing/src/fake-backends/{scripted,replay,conformance,index}.ts` + cassette
fixtures under `testing/fixtures/cassettes/<provider>/<name>.json`.

**Scripted fake** — constructed from a `BackendScript`:

```ts
interface BackendScript {
  capabilities: Capabilities;          // 0019 shape; presets: claudeLike, codexLike, selfHostedLike
  // per dispatch, how the "provider cloud" responds (or doesn't):
  onDispatch: (brief, ctx) => DispatchOutcome;
}
type DispatchOutcome =
  | { kind: 'opens-pr'; branch?: string; trailer?: string; issueRef?: number; afterTicks?: number; diff?: FakeDiff }
  | { kind: 'comments-only'; body: string }   // e.g. @codex acknowledgement
  | { kind: 'no-result' }                      // silent drop → sweep timeout (0073/0076)
  | { kind: 'error'; reason: string };
```

`dispatch(brief, ctx)` returns a `DispatchHandle` carrying the `run_id` correlation
(0073). By default the fake **defers** the PR: it enqueues the synthetic PR onto the
fake GitHub's event queue (0083), authored by the **"provider app" identity** (not
the `looper` token) so the resulting `pull_request` event actually re-triggers — this
is what makes the async split real in tests. The synthetic PR is built to satisfy
all three correlation signals by default: head branch `looper/<loop>/<issue>-<run_id>`,
a `looper-run: <run_id>` body trailer, and a `#<issue>` ref — but `BackendScript` can
omit/corrupt any one to test the defense-in-depth match precedence (0073). `ingest`
is the **real** correlation+result logic (delegated to / shared with 0073), not a
stub — the fake only fabricates inputs, never short-circuits the matcher.

**Capability presets** mirror the real backends so the runner's capability-driven
branches (0019) are exercised: `claudeLike` (`trigger_modes:[api_fire]`, sandbox,
`secret_phase:full`, network on), `codexLike` (`trigger_modes:[mention]`,
`secret_phase:setup-only`, `network:off`, `opens_pr:true`), `selfHostedLike`.

**Replay backend** — `record | replay | live` mode via env (e.g.
`LOOPER_CASSETTE=replay`, default in CI). A **cassette** is a deterministic JSON
recording of one dispatch→ingest exchange: the dispatch input fingerprint (a stable
hash of the brief contract + capabilities — NOT raw secrets/tokens), the provider
reference returned, and the sequence of GitHub artifacts (PR + comments + checks)
the provider produced. In `record` mode it wraps the real backend (0020/0021) +
real GitHub and writes the cassette; in `replay` mode it serves from the cassette
and feeds the artifacts to the fake GitHub for `ingest`. **Redaction is mandatory**:
a scrub pass strips tokens/secrets/PII from cassettes before write (codex
secret-stripping parity); cassette write is rejected if the scrubber flags residue.
A replay with no matching cassette **fails loudly** (no silent network fallthrough).

**Conformance suite** — a table-driven `runBackendConformance(makeBackend)` asserting
every impl: `capabilities()` returns a well-formed `Capabilities`; `dispatch` is
async/non-blocking and yields a `DispatchHandle` with a `run_id`; `ingest` returns
`null` for a foreign PR and a populated `IngestResult` for a correlated one;
idempotent `ingest` (same event twice → one effect). Run against the scripted fake,
the replay backend (with a fixture cassette), and — in tier-2 — the real backends.

**Edge cases:** `no-result` outcome (drives the sweep timeout/escalation path,
0073/0076); duplicate PR-event delivery (idempotent ingest); a PR matching no
correlation signal (`ingest → null`); `afterTicks` deferral driven by the injected
clock (M18 · 0086) so storms/races are reproducible; corrupted/partial cassette →
hard error.

## Out Of Scope

- The fake GitHub itself (0083); the scenario runner & goldens (0085); fault
  injection / clock (0086); the live-smoke gate & CI wiring (0087).
- Real provider dispatch mechanics (0020/0021) and correlation internals (0073) —
  reused, not reimplemented here.

## Acceptance Criteria

- [x] A scripted fake `Backend` implements `capabilities`/`dispatch`/`ingest` and is
      a drop-in for the real backends in the runner (0012).
- [x] `dispatch` synthesizes a provider PR on the fake GitHub (authored by the
      provider identity) and runs the **real** correlation in `ingest`; a foreign
      PR ingests as `null`/pending.
- [x] The scripted behaviors corrupt correlation signals (`rogue-pr` → branch +
      trailer, exercising the dispatch-signal fallback) and emit `no-result`
      (`silent` → the sweep timeout path). Per-signal omission is coarse (noted).
- [x] The replay backend replays a cassette deterministically and a missing
      cassette fails loudly (throws, no network). Record-once/scrub-on-write is
      not implemented — cassettes are hand-authored (secret-clean by construction).
- [x] `ingest` is idempotent under duplicate delivery (proven in the conformance
      suite + the 0086 duplicate-webhook simulation).
- [x] `runBackendConformance` passes for the scripted fake + the replay backend
      with **zero quota**; the real backends run it under tier 5 (operator-gated).
- [x] Capability presets (`claudeLike`/`codexLike`/`selfHostedLike`) exist and
      exercise the runner's capability-driven branches.

## Implementation Checklist

- [x] Scripted fake over the 0019 interface, PR synthesis through the fake GitHub
      (0083) — realized as a `behavior` enum (`open-pr`/`silent`/`fail-dispatch`/
      `fail-ingest`/`rogue-pr`) rather than a named `BackendScript`/`DispatchOutcome`.
      See Decisions.
- [x] Provider-identity PR authorship + the three correlation signals; the
      `rogue-pr` behavior corrupts branch+trailer (exercises the dispatch-signal
      fallback, 0093). Per-signal omission is coarse (not yet individually knobbed).
- [x] Replay backend over a cassette + missing-cassette hard failure (throws, no
      network fallthrough). `record`/`live` modes + scrub-on-write are NOT
      implemented — cassettes are hand-authored (so secret-clean by construction).
- [x] Capability presets (`claudeLike`/`codexLike`/`selfHostedLike`) mirroring the
      real backends.
- [x] `runBackendConformance(makeBackend)` across the fake + replay backends (real
      backends run it under tier 5, operator-gated).
- [ ] Committed fixture cassette files for Claude/Codex — deferred; cassettes are
      currently authored inline in tests. (Real recordings are operator-pending.)

## Test Plan

Tests run via `vitest` (per [codebase](../../docs/codebase.md)); behavioral tests
use these M18 fakes only — **no real quota, no network**.

```bash
# scripted: dispatch → synthetic PR event → real ingest correlates + advances once
# replay:   LOOPER_CASSETTE=replay drives a recorded exchange deterministically
# conformance: runBackendConformance passes for scripted, replay, and real backends
# edges: no-result → sweep timeout; duplicate event → idempotent; foreign PR → null;
#        missing cassette → hard error; cassette scrub rejects residual secrets
```

## Verification Log

- 2026-06-12: `runBackendConformance` green for both the scripted `FakeBackend`
  and the `ReplayBackend` (`packages/testing/test/backend-conformance.test.ts`,
  8 tests): well-formed capabilities, dispatch returns a handle carrying the
  three signals, ingest correlates the provider PR, and re-ingest is idempotent
  (no duplicate PR). Capability presets verified against the real backends'
  distinguishing flags (claude api_fire/zdr-false; codex mention/setup-only/5-per-
  hour; self-hosted dispatch/zdr-true/uncapped). The `ReplayBackend` is also
  proven golden-equal to the `FakeBackend` end-to-end in the 0085 scenario suite,
  and idempotent ingest is re-proven by the 0086 duplicate-webhook simulation.

## Decisions

- The scripted fake is a `behavior` enum (`open-pr`/`silent`/`fail-dispatch`/
  `fail-ingest`/`rogue-pr`) rather than the planned `BackendScript`/
  `DispatchOutcome` types — simpler and sufficient: `rogue-pr` corrupts the
  branch+trailer to exercise the dispatch-signal fallback (0093), `silent` drives
  the sweep timeout, the fail-* behaviors drive the failure paths. `ingest` calls
  the REAL `listPullRequestsByHeadPrefix` + correlation, never a reimplementation
  (0073), so the fake exercises the production match logic.
- The `ReplayBackend` reads a plain-JSON `Cassette` (capabilities + per-loop
  exchange: dispatch signal + the PR to replay, with `{branch}`/`{trailer}`/
  `{issue}` placeholders expanded from the handle). It replays only — no
  `record`/`live` mode and no scrub-on-write — because cassettes are hand-authored
  (so secret-clean by construction); a loop with no matching exchange THROWS (the
  loud missing-cassette failure, never a network fallthrough). Recording real
  exchanges + scrub-on-write is operator-pending (tier-5 territory).

## Risks / Rollback

If the fakes drift from the real backends' behavior, scenario tests pass while
production breaks — the conformance suite (run against real backends in tier-2) and
the gated live smoke (0087) exist to catch exactly that. Cassette redaction is
safety-critical: a leaked token in a committed fixture is a real exposure, so scrub
failures must hard-block the write. Dev-only package — remove or revert in isolation
without touching shipped code.

## Final Summary

A scripted `FakeBackend` (behavior enum) and a cassette-driven `ReplayBackend`
both implement the `ExecutionBackend` contract and share the REAL correlation
code (0073) in `ingest` — drop-in for the runner, zero quota. Both pass a single
`runBackendConformance` suite (capabilities, three-signal dispatch, correlated +
idempotent ingest), and the replay backend is golden-equal to the fake end-to-end
(0085). Capability presets mirror the three real backends. Record-once/`--rerecord`
+ committed real cassettes are operator-pending; a missing cassette fails loudly.
