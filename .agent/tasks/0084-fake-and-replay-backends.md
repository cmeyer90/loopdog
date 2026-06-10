# 0084 Fake & Replay Backends

Status: planned  
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

- [ ] A scripted fake `Backend` implements `capabilities`/`dispatch`/`ingest` and is
      a drop-in for the real backends in the runner (0012).
- [ ] `dispatch` defers a synthetic provider PR onto the fake GitHub event queue
      (authored by the provider identity) and runs the **real** correlation in
      `ingest`; a foreign PR ingests as `null`.
- [ ] `BackendScript` can omit/corrupt individual correlation signals (branch /
      trailer / issue ref) to test match precedence, and can emit `no-result` to
      drive the sweep timeout path.
- [ ] A replay backend records once and replays deterministically; cassettes are
      secret-scrubbed on write and a missing cassette fails loudly (no network).
- [ ] `ingest` is idempotent under duplicate event delivery (proven in the suite).
- [ ] A `runBackendConformance` suite passes for the scripted fake, the replay
      backend, and the real backends, with **zero quota** spent in `replay`/scripted.
- [ ] Capability presets (`claudeLike`/`codexLike`/`selfHostedLike`) exist and
      exercise the runner's capability-driven branches.

## Implementation Checklist

- [ ] Define `BackendScript` + `DispatchOutcome` and the scripted fake over the
      0019 interface, wiring PR synthesis through the fake GitHub (0083).
- [ ] Implement deferred-PR enqueue with provider-identity authorship + the three
      correlation signals (with per-signal omission knobs).
- [ ] Implement the replay backend (`record`/`replay`/`live`) + cassette format +
      mandatory secret-scrub-on-write + missing-cassette hard failure.
- [ ] Implement capability presets mirroring the real backends.
- [ ] Implement `runBackendConformance(makeBackend)` and run it across fake/replay/real.
- [ ] Add fixture cassettes for one Claude and one Codex exchange.

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

Add dated entries here as work proceeds.

## Decisions

Record the `BackendScript`/`DispatchOutcome` shape, the cassette JSON schema +
fingerprint/redaction rules, the `record|replay|live` switch, and how `ingest`
shares the real correlation code (0073) rather than duplicating it.

## Risks / Rollback

If the fakes drift from the real backends' behavior, scenario tests pass while
production breaks — the conformance suite (run against real backends in tier-2) and
the gated live smoke (0087) exist to catch exactly that. Cassette redaction is
safety-critical: a leaked token in a committed fixture is a real exposure, so scrub
failures must hard-block the write. Dev-only package — remove or revert in isolation
without touching shipped code.

## Final Summary

Fill this in before marking verified.
