# 0087 Tiered CI Wiring & Live Smoke

Status: planned  
Branch: task/0087-tiered-ci-and-live-smoke

## Goal

Wire the five-tier test pyramid into looper's own CI so every PR runs tiers 1–4
deterministically, offline, with **zero subscription quota**, and add a tier-5
**live smoke** — a tiny real-repo/real-subscription run behind a manual/nightly
gate — to catch provider API drift without gating every PR on it.

## Background

Part of [Milestone 18](../milestones/milestone-18-test-and-simulation-harness.md);
the capstone that turns the fakes (0083), backends/cassettes (0084), scenario
runner (0085), and simulation harness (0086) into an enforced gate. It builds on
the conformance suite (0084) and golden scenarios (0085) and adds the only tier
that spends real quota. See [codebase](../../docs/codebase.md) "Testing strategy"
(the five-tier pyramid; "Provider calls in tiers 2–4 use scripted fakes or
record-once/replay cassettes") and [architecture](../../docs/architecture.md)
"Verified provider capabilities" (routines are beta — the drift this smoke
catches). The live smoke exercises the **real** `dispatch → ingest` correlation
(0073) against a real provider, the one path the fakes can only approximate.

## Scope

- A **tier runner** in `@looper/testing` that classifies and selects tests by tier
  (1 unit · 2 component · 3 scenario · 4 simulation · 5 live-smoke) so CI can run
  "tiers 1–4" cheaply and "tier 5" only when gated.
- **CI wiring**: a `looper-ci.yml` GitHub Actions workflow running tiers 1–4 on
  every PR/push — pinned to `LOOPER_CASSETTE=replay`, network-blocked, no secrets —
  plus a separate `looper-live-smoke.yml` gated to manual dispatch + nightly cron.
- A **live-smoke harness**: a minimal end-to-end run (one safe loop, one scratch
  repo, one real subscription) that proves dispatch→ingest still works against the
  live provider, reports drift, and **never** gates per-PR CI.
- A **drift report**: when the live smoke fails, surface *what* drifted (capability
  shape, routine API, PR/correlation contract) and optionally re-record cassettes.

### Technical detail

**Package / files** (`@looper/testing`, dev-only): the tier registry +
classification live in `testing/src/tiers/{registry,select,index.ts}`; the live
smoke in `testing/src/live-smoke/{harness,drift-report,index.ts}`. The CI workflows
ship as repo-level assets under `.github/workflows/looper-ci.yml` and
`.github/workflows/looper-live-smoke.yml` (looper's OWN CI, not the
`templates/workflows/` adopters get).

**Tier selection.** Tag tests by tier via a convention vitest can filter without a
plugin — a per-tier `vitest.<tier>.config.ts` with an `include`/`exclude` glob
(e.g. tier-5 lives only in `**/*.live.test.ts`, excluded from the default run), and
an env switch `LOOPER_TIER=1-4|5|all` the tier runner maps to the right config(s).
Default (`vitest run`) = tiers 1–4. Tier 5 is opt-in only.

```ts
// testing/src/tiers/registry.ts
export type Tier = 'unit' | 'component' | 'scenario' | 'simulation' | 'live-smoke';
export interface TierSpec {
  tier: Tier;
  include: string[];                 // vitest globs
  requires: ('quota' | 'network' | 'secrets')[];   // tier-5 only; 1–4 = []
}
```

**Hermeticity invariant (the load-bearing guarantee).** Tiers 1–4 must be provably
offline and quota-free. Enforce, not just assume:
- `LOOPER_CASSETTE=replay` pinned in `looper-ci.yml`; a missing cassette **fails
  loudly** (0084) — never falls through to network.
- A **network guard** installed in the test setup for tiers 1–4 that throws on any
  outbound socket (real GitHub / provider host), so an accidental real-IO call is a
  red test, not a silent quota burn. Allowlist = empty for 1–4.
- No provider/`GITHUB_TOKEN` secrets present in the tiers-1–4 job env (assert their
  absence in a setup check).

**CI workflow — `looper-ci.yml`** (looper's own repo): triggers `pull_request` +
`push`; steps = install → build → lint → `LOOPER_TIER=1-4 vitest run` (which runs
unit + the 0084 conformance suite in `replay` + the 0085 goldens + the 0086
simulation invariants). This is a required check. No secrets, no network.

**CI workflow — `looper-live-smoke.yml`**: triggers `workflow_dispatch` (manual) +
`schedule` (nightly cron, e.g. `0 7 * * *`); reads the real subscription
credential from a repo secret available only to this gated workflow; steps =
build → `LOOPER_TIER=5 vitest run`. Failure here opens/updates a tracking issue
(dogfooding looper's own escalation) but **does not** block merges. Concurrency-
guarded so nightly + manual don't overlap and double-spend quota.

**Live-smoke harness** (`testing/src/live-smoke/harness.ts`): given a scratch repo
slug + a configured real backend (`claude` or `codex`, 0020/0021), seed one safe
issue (`tier:safe`), run **one** real loop transition through the real controller
to a real `dispatch`, wait (bounded) for the provider's PR, run the real `ingest`
(0073) correlation, assert: a correlated PR appeared, labels advanced one edge,
a run-record was emitted. Then clean up (close PR/issue, delete branch). Keep it
**minimal** — one loop, one edge, one provider per run — to stay inside provider
rate caps (~5/hr Codex). Parameterized by provider so the matrix can rotate
Claude/Codex across nights.

**Drift report** (`testing/src/live-smoke/drift-report.ts`): on smoke failure,
diff what was observed against the recorded cassette's fingerprint (0084) and the
declared `Capabilities` (0019) and emit a structured report — *capability drift*
(shape/flags changed), *API drift* (routine `/fire` or `@codex` contract changed),
or *correlation drift* (branch/trailer/issue-ref shape changed). Offer a
`--rerecord` path that regenerates the affected cassette (secret-scrubbed on write,
0084) so the fix is a reviewed fixture update, not a silent re-record.

**Edge cases:** provider rate-cap hit mid-smoke → report `skipped(rate-capped)`,
not `failed` (no false alarm); no PR within the bounded wait → `failed` with the
no-result/timeout diagnostic (the live analogue of the sweep path, 0073/0076);
scratch-repo cleanup must run in a `finally`/post step even on failure so nights
don't accrete dead branches; a tier-1–4 test that *needs* IO is a bug — the
network guard makes it fail in PR CI, not nightly.

## Out Of Scope

- The fakes/cassettes themselves (0083/0084), the scenario runner & goldens (0085),
  and the simulation clock/fault injection (0086) — consumed here, not built.
- The adopter-facing reusable workflows in `templates/workflows/` — this task wires
  **looper's own** CI; the adopter's CI gate is the verification ladder, not this.
- Any change that lets a real model API call onto the per-PR primary path.

## Acceptance Criteria

- [ ] A tier runner selects tests by tier; `LOOPER_TIER=1-4` runs unit + component
      (0084 conformance, `replay`) + scenario (0085 goldens) + simulation (0086)
      and `LOOPER_TIER=5` runs only the live smoke.
- [ ] `looper-ci.yml` runs tiers 1–4 on every PR/push with **no secrets, no
      network, and `LOOPER_CASSETTE=replay`**, and is a required check.
- [ ] A network guard makes any outbound socket in tiers 1–4 a failing test, and a
      missing cassette fails loudly — so per-PR CI provably spends **zero quota**.
- [ ] `looper-live-smoke.yml` runs only on manual dispatch + nightly cron, uses the
      real subscription secret, and never gates a PR merge.
- [ ] The live smoke runs one real loop edge end-to-end (dispatch → real provider
      PR → real ingest → one-edge advance + run-record) and cleans up the scratch
      repo even on failure.
- [ ] On smoke failure a drift report classifies capability/API/correlation drift,
      and `--rerecord` regenerates the affected cassette (secret-scrubbed).
- [ ] A rate-capped smoke reports `skipped`, not `failed`.

## Implementation Checklist

- [ ] Define the `TierSpec` registry + per-tier vitest configs + the `LOOPER_TIER`
      selector in `testing/src/tiers/`.
- [ ] Implement the tiers-1–4 network guard + secret-absence assertion in the test
      setup; wire `LOOPER_CASSETTE=replay` as the CI default.
- [ ] Add `.github/workflows/looper-ci.yml` (tiers 1–4, required, no secrets) and
      `.github/workflows/looper-live-smoke.yml` (manual + nightly, gated secret,
      non-blocking, concurrency-guarded).
- [ ] Implement the live-smoke harness (one safe loop, scratch repo, real backend,
      bounded wait, real ingest, run-record assertion, guaranteed cleanup).
- [ ] Implement the drift report + `--rerecord` cassette regeneration.
- [ ] Wire smoke failure to open/update a tracking issue (no merge gating).

## Test Plan

Tests run via `vitest` (per [codebase](../../docs/codebase.md)). Tiers 1–4 use the
M18 fakes/cassettes (0083/0084) only — **no real quota, no network**. Tier 5 is the
only tier that touches a real subscription and is never run in per-PR CI.

```bash
# tier selection: LOOPER_TIER=1-4 vitest run → unit+component+scenario+simulation only
# hermeticity: a tier-1–4 test attempting a real socket → FAILS (network guard)
# hermeticity: replay with a missing cassette → FAILS loudly (no network fallthrough)
# secrets: assert no provider/GITHUB_TOKEN secret present in the tiers-1–4 job env
# live (manual/nightly only): LOOPER_TIER=5 → one real edge dispatch→ingest, then cleanup
# drift: feed a mismatched capability/correlation → drift-report classifies + --rerecord updates the cassette
# rate-cap: simulate a cap response → smoke reports skipped, not failed
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the tier-tagging mechanism (per-tier vitest configs + `LOOPER_TIER`), the
network-guard implementation, the two workflow files' triggers/secrets/gating, the
live-smoke scope (one loop/edge/provider per run) and its rate-cap policy, and the
drift-report taxonomy + `--rerecord` flow.

## Risks / Rollback

The central risk is a tier-1–4 leak that spends real quota or hits real GitHub on a
PR — the network guard + secret-absence check + `replay`-pinning + loud
missing-cassette failure must all be in place; treat any of them missing as a
release blocker. The live smoke can flake on provider rate caps or transient
provider outages — hence non-blocking + `skipped`-on-cap so it never blocks merges
or pages falsely; its value is the drift signal, recorded to a tracking issue. All
artifacts are dev-only (`@looper/testing`) or repo-level CI YAML — revertable in
isolation without touching shipped packages.

## Final Summary

Fill this in before marking verified.
