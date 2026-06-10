# 0028 Adapter Authoring Guide & Test Kit

Status: planned  
Branch: task/0028-adapter-authoring-guide-and-testkit

## Goal

Let a third party author a correct `ProjectAdapter` and *prove* it conforms without
reading looper's internals: ship (a) an authoring guide that documents the
`detect / build / test / lint / run / deploy` contract end-to-end, and (b) a reusable
**conformance test kit** — a single exported function an adapter's own test file
calls to assert it satisfies every clause of the port. The same kit gates the
bundled adapters (0027) and the generic adapter (0026), so "conforms" means one
thing repo-wide.

## Background

Part of [Milestone 06](../milestones/milestone-06-project-adapter-system.md) — the
project-adapter plugin system, the second of looper's three genericity surfaces
([architecture](../../docs/architecture.md) "Generic-ness, in three plugin systems"
→ *Project adapters*). The milestone's Definition-of-Done requires that "third
parties can author and verify an adapter using the guide + test kit," and its
Guiding Decisions state adapters must be "testable in isolation with a conformance
test kit." This is the M06 analogue of the backend conformance harness (0019) and
realizes the [codebase](../../docs/codebase.md) decision: "No plugin-loader/
marketplace framework — backends and adapters are a small fixed registry behind an
interface; third parties use the conformance kit (M06 · 0028)." It consumes the
frozen `ProjectAdapter` contract (0024), references the generic adapter (0026) and
bundled adapters (0027) as worked examples, and lives partly in `@looper/testing`
(the kit) and partly in `docs/` (the guide). The kit runs at the **component tier**
of the M18 pyramid (each port impl vs. a fake counterpart) using the M18 fakes — no
real provider quota, no child processes.

## Scope

- A `runAdapterConformance(makeAdapter, opts)` function exported from
  `@looper/testing` that drives every clause of the 0024 `ProjectAdapter` contract
  against a candidate adapter and fails with a clear message on any violation.
- A fixture set (`RepoFs` snapshots + a scripted fake `CommandRunner`) the kit uses
  so the suite is deterministic, offline, and process-free.
- An authoring guide at `docs/adapters.md` walking the full lifecycle:
  contract reference → scaffold → implement `detect`/capabilities/commands →
  register → run the kit → publish.
- Wiring: the kit is invoked by the bundled (0027) and generic (0026) adapter test
  suites so they and any third-party adapter share one definition of conformance.

### Technical detail

**Lands in:** `@looper/testing` (`packages/testing/src/conformance/adapter.ts` +
fixtures under `packages/testing/src/conformance/fixtures/`) and `docs/adapters.md`.
The kit depends on `@looper/core` (for the `ProjectAdapter` types frozen by 0024)
and the M18 fakes (0083 + the fake `CommandRunner`); it is **dev-only**, never
shipped (codebase: `testing` is "Not shipped").

**Kit signature** (`@looper/testing`):

```ts
export interface AdapterConformanceOpts {
  /** Repo snapshots: at least one this adapter SHOULD match, and the no-match case. */
  fixtures: { name: string; repo: RepoFs; expectMatch: boolean }[];
  /** Scripted exec results keyed by phase, so build/test/lint/run/deploy are offline. */
  runner?: FakeCommandRunner;          // defaults to an all-exit-0 stub
  /** Phases the adapter claims to support; the kit asserts capabilities() agrees. */
  expectCapabilities?: Partial<AdapterCapabilities>;
}

/** Throws (via the vitest assertions it registers) on any contract violation. */
export function runAdapterConformance(
  makeAdapter: () => ProjectAdapter,
  opts: AdapterConformanceOpts,
): void;   // call inside a describe(); it registers its own it() cases
```

**Clauses the kit asserts** (one per 0024 acceptance criterion, each a named
`it()`):

1. **Shape** — the object exposes a `name` string and implements every method
   (`detect`, `capabilities`, `describe`, `build`, `test`, `lint`, `run`, `deploy`);
   types check at compile time, presence checked at runtime.
2. **Detect contract** — for each fixture, `detect()` returns a `DetectResult` with
   a numeric `confidence` in `[0,1]` and `matched === expectMatch`; a non-matching
   repo yields low/zero confidence (no false claim — the generic-adapter rule, 0026).
3. **Capability honesty** — `capabilities()` matches `expectCapabilities`, and for
   every phase reported `false` the corresponding method returns
   `{ ok: true, skipped: true, durationMs: 0 }` rather than throwing; for every
   phase reported `true` it actually invokes the runner.
4. **Result normalization** — every lifecycle method returns a well-formed
   `CommandResult` (`ok: boolean`, `output: string`, `durationMs: number ≥ 0`); a
   scripted non-zero exit yields `ok: false` with captured output; a clean exit
   yields `ok: true`.
5. **No direct spawning** — the adapter only runs commands through the injected
   `CommandRunner` (the kit injects a `FakeCommandRunner` and asserts the adapter
   never touched `node:child_process` — verified by the fake recording every call
   and by the adapter receiving zero real PIDs).
6. **Describe** — `describe()` returns an `AdapterDescription` documenting the
   command per supported phase (the strings the brief composer, M03 · 0012, surfaces
   to the work cell), and they are non-empty for supported phases.
7. **Idempotent detect** — calling `detect()` twice on the same `RepoFs` yields the
   same result (pure, filesystem-read-only — no hidden state).

**Fixtures.** `packages/testing/src/conformance/fixtures/` ships a tiny library of
`RepoFs` snapshots reusable across adapters — `node-npm/`, `node-pnpm/`,
`python-uv/`, `empty/` (the no-match case) — each a file-listing + a few manifest
contents, mirroring the input shape 0025/0027 consume. The `FakeCommandRunner`
returns scripted `{ exitCode, stdout, stderr, durationMs }` per phase so the kit can
exercise both the pass and fail branches without spawning anything.

**Authoring guide (`docs/adapters.md`)** — sections:
- *What an adapter is*: the 0024 contract, the IO boundary (adapters describe *what*
  to run; `@looper/runtime` owns *how*), and why commands feed both the adopter's CI
  gate (M03 · 0014) and the dispatched brief (M03 · 0012).
- *Scaffold*: a copyable skeleton implementing `ProjectAdapter` with TODOs.
- *Implement detect*: how `confidence` is scored and why generic must never
  out-confidence a real match (0025/0026).
- *Implement commands*: returning `CommandResult`, the skipped-vs-failed semantics
  (0024), and the secret-redaction expectation for output (0026 — never leak into
  the run record).
- *Register*: adding the adapter to the fixed registry array in `@looper/adapters`
  (no plugin loader); the override precedence (`adapter.commands` > derived >
  default) it must honor.
- *Verify*: a 6-line `adapter.conformance.test.ts` calling `runAdapterConformance`,
  plus how to run it (`vitest`).
- *Publish*: the contract is **version-pinned** to the 0024 interface; a guide
  callout names the exported `ADAPTER_CONTRACT_VERSION` so third parties can detect a
  breaking bump.

**Contract version.** Export an `ADAPTER_CONTRACT_VERSION` constant from
`@looper/core` (the 0024 port surface); the kit asserts the adapter was authored
against the current version (advisory, not a hard gate) so the guide and kit can
evolve without silently mis-validating an old adapter.

## Out Of Scope

- The `ProjectAdapter` interface and result types themselves (0024) — this task
  documents and tests them; it does not define them.
- Auto-detection selection policy (0025), the generic adapter (0026), and the
  bundled node/python adapters (0027) — they are *consumers/examples* of the kit.
- A plugin loader, dynamic discovery, or an adapter marketplace (explicitly post-V1;
  the registry stays a fixed array).
- Executing real builds/deploys or any live-smoke run (M11; M18 tier 5).
- The backend conformance harness (0019) — a separate sibling for M05.

## Acceptance Criteria

- [ ] `@looper/testing` exports `runAdapterConformance(makeAdapter, opts)` that
      registers an `it()` per contract clause and fails with a clear message on any
      violation.
- [ ] The kit asserts: full method shape; `detect()` confidence in `[0,1]` with
      correct `matched`; capability honesty (skipped vs. invoked); `CommandResult`
      normalization (pass/fail/skipped); no direct process spawning; non-empty
      `describe()` for supported phases; idempotent `detect()`.
- [ ] A reusable fixture library (`node-*`, `python-*`, `empty`) + a scripted
      `FakeCommandRunner` make the suite deterministic, offline, and process-free.
- [ ] Both bundled adapters (0027) and the generic adapter (0026) call the kit from
      their own test suites and pass it.
- [ ] An intentionally-broken sample adapter (throws on a missing phase, or claims a
      capability it doesn't run) **fails** the kit — proving the kit catches
      violations, not just green paths.
- [ ] `docs/adapters.md` exists and walks contract → scaffold → detect → commands →
      register → verify → publish, with a copyable ~6-line conformance test snippet.
- [ ] `ADAPTER_CONTRACT_VERSION` is exported and referenced by both the kit and the
      guide.
- [ ] Relevant checks pass (lint, typecheck, `vitest`).

## Implementation Checklist

- [ ] Implement `runAdapterConformance` + `AdapterConformanceOpts` in
      `packages/testing/src/conformance/adapter.ts`; export via the testing barrel.
- [ ] Add the `FakeCommandRunner` (scripted, call-recording) if not already provided
      by the M18 fakes (0083), and the `RepoFs` fixture snapshots.
- [ ] Add `ADAPTER_CONTRACT_VERSION` to `@looper/core`'s adapter port (0024).
- [ ] Write a deliberately-broken `BrokenAdapter` test fixture and assert the kit
      rejects it (negative test for the kit itself).
- [ ] Wire the kit into 0026 and 0027 test suites.
- [ ] Author `docs/adapters.md` with the scaffold, the redaction/skip rules, and the
      copyable conformance snippet; cross-link from `docs/codebase.md` adapters row.

## Test Plan

Tests run via the repo's `vitest` runner (M18 component tier). The kit is itself
exercised by a known-good fake adapter and a known-bad one, both built on the M18
fakes — no real provider quota, no child processes spawned.

```bash
# replace with this repo's runner once finalized (0001)
npm run -w @looper/testing test
# cases:
#  - a conformant fake adapter passes every kit clause
#  - BrokenAdapter (throws on skipped phase / lies about capabilities) FAILS the kit
#  - generic (0026) and node/python (0027) suites invoke runAdapterConformance green
#  - detect() idempotence + confidence-range assertions hold across fixtures
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final `runAdapterConformance` signature and clause list, the fixture
library layout, how "no direct spawning" is asserted, and the
`ADAPTER_CONTRACT_VERSION` semantics (advisory vs. hard gate).

## Risks / Rollback

- **A weak kit (green-washing).** If the kit only checks happy paths it certifies
  broken adapters; the mandatory `BrokenAdapter` negative test is the guard — the
  kit must fail it before the kit is trusted.
- **Contract drift.** If 0024 changes after this lands, the kit and guide go stale;
  `ADAPTER_CONTRACT_VERSION` makes a bump detectable, and the kit is pinned to the
  `@looper/core` types so a breaking change fails to compile rather than silently
  mis-validating.
- **Over-promising third-party support.** The guide must state the registry is a
  fixed array (no dynamic loading) so authors PR their adapter in rather than
  expecting runtime discovery — matching the post-V1 marketplace exclusion.

Rollback is low-cost: the kit and guide are dev-only/docs and ship no runtime
behavior; removing them reverts to the bundled adapters' bespoke tests.

## Final Summary

Fill this in before marking verified.
