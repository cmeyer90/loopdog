# 0041 Verification Ladder Wiring

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Define the verification ladder as data and bind its rungs to the *adopter's own*
required GitHub checks, so the merge DoD gate (M03 · 0014) evaluates a single,
explicit ladder result instead of ad-hoc check lookups. This is the structural
spine the rest of Milestone 10 (review cell 0042, intent-diff 0043, auto-merge
0045) hangs off of.

## Background

Part of [Milestone 10](../milestones/milestone-10-review-verification-ladder-and-merge-loop.md).
The ladder is the trust model: each rung is harder to fake than the last, and
merge authority is gated on rungs 2–4 — never on the agent's self-tests (rung 1).
See [architecture](../../docs/architecture.md) "The verification ladder (trust)"
and "How we know the request was satisfied." The rung-2 floor is the adopter's
required checks + branch protection — trustworthy *regardless of where the work
cell ran* — which is why looper reads check status from GitHub rather than
trusting any provider-reported pass. This task produces the ladder definition +
evaluator that 0014's DoD predicate consumes; it does not itself perform review
(0042/0043), deploy smoke (M11 · 0047), or merge (0045).

## Scope

- A typed ladder model in `core`: rungs, their sources, and how a rung resolves
  to pass / fail / pending / not-applicable from GitHub state.
- Binding rung 2 to the adopter's *required* status checks (discovered from
  branch-protection / rulesets), not a looper-invented list.
- A pure `evaluateLadder()` that the DoD gate (0014) calls, returning a structured
  result the merge loop and CLI can render.
- Per-loop ladder config in `loop.yml` (which rungs are required for this loop).

### Technical detail

**Package:** the ladder model + evaluator are pure domain → `@looper/core`
(`core/src/gates/ladder.ts`, exported from `index.ts`). Required-check discovery
and check-run/review status reads are IO → `@looper/github`
(`github/src/checks/`). The ladder config schema lands in `@looper/config`. The
DoD gate in 0014 (already in `core/src/gates/`) calls `evaluateLadder` and treats
"all required rungs pass" as the merge predicate.

**Ladder model (core):**

```ts
type RungId = 'self_test' | 'ci' | 'review' | 'deploy_smoke' | 'human';
type RungStatus = 'pass' | 'fail' | 'pending' | 'not_applicable';

interface RungResult {
  rung: RungId;
  status: RungStatus;
  required: boolean;          // gates merge for this loop+tier?
  detail: string;             // human-readable ("3/3 required checks green")
  evidence?: { checks?: string[]; reviewUrl?: string; smokeRunId?: string };
}

interface LadderResult {
  pr: { repo: string; number: number };
  rungs: RungResult[];
  mergeable: boolean;         // every required rung === 'pass'
  blockedBy: RungId[];        // required rungs not yet 'pass'
}
```

**Rung sources (how each resolves):**

- **Rung 1 `self_test`** — advisory only, *never required*. Surfaced from the
  ingest run record (provider-reported); may be `not_applicable` under Codex
  secret-stripping / no agent-phase internet. Recorded for visibility, excluded
  from `mergeable`.
- **Rung 2 `ci`** — the floor. Resolve the PR head SHA's check-runs + commit
  statuses, intersect with the **required** check contexts from branch protection
  (`GET /repos/{o}/{r}/branches/{b}/protection/required_status_checks` and the
  rulesets API; fall back to "all checks must pass" when protection is
  unreadable). `pass` iff every required context concluded `success`; `pending`
  if any is queued/running; `fail` on any failure/timeout. Looper does NOT invent
  checks — it reads the adopter's. CODEOWNERS/branch-protection enforcement is the
  repo's, not looper's.
- **Rung 3 `review`** — cross-provider review approval, produced by 0042/0043.
  Resolve from PR review state (an approval whose author is the looper-dispatched
  reviewer) + the run record's review-cell outcome. This task defines the slot and
  reads the status; the review itself is 0042/0043.
- **Rung 4 `deploy_smoke`** — `not_applicable` unless the loop deploys; otherwise
  resolved from the smoke/canary gate (M11 · 0047) via a check-run or run-record
  artifact. Slot defined here; producer is M11.
- **Rung 5 `human`** — dogfooding backstop; informational, gated by CODEOWNERS at
  the GitHub layer, surfaced but not part of `mergeable`.

**Per-loop config (`loop.yml`, schema in `@looper/config`):**

```yaml
gates:
  ladder:
    require: [ci, review]      # rungs that must pass to merge (rungs 2–4 subset)
    deploy_smoke: false        # promotes deploy_smoke to required when true
```

Defaults: `require: [ci, review]`; `self_test`/`human` are never addable to
`require` (config validation rejects them — they cannot gate merge). The
risk-tier policy (0045) may *tighten* requirements but never drops rung 2.

**Edge cases (fail closed):**
- Required-check list unreadable / branch protection off → treat as "all checks
  required," `pending` until at least one concludes; never silently `pass`.
- No check-runs reported yet (provider PR just opened) → `pending`, not `fail`.
- Stale SHA (PR updated after a rung resolved) → re-evaluate against the current
  head SHA; a rung result is only valid for the SHA it was computed on.
- A required context that never reports within the lease (0073) → surfaces as
  `pending`; escalation is the sweep's job (M12 · 0051), not the ladder's.

## Out Of Scope

- The cross-model review dispatch + approval (0042) and intent-diff (0043).
- Deploy smoke production (M11 · 0047) and rollback (0048).
- The auto-merge decision + tier policy (0045) — this returns `mergeable`; 0045
  decides whether to act on it autonomously or hold for a human.
- Defining the acceptance-criteria marker block (0014) and DoR (0014).

## Acceptance Criteria

- [x] A typed ladder model (`RungResult`/`LadderResult`) is defined in
      `@looper/core` and exported.
- [x] Rung 2 binds to the adopter's **required** check contexts discovered from
      branch protection/rulesets, not a looper-defined list.
- [x] `evaluateLadder()` returns `mergeable: true` only when every *required* rung
      is `pass`, and lists `blockedBy` otherwise.
- [x] `self_test` and `human` can never be marked required (config validation
      rejects them; they never affect `mergeable`).
- [x] Per-loop `gates.ladder.require` / `deploy_smoke` config is parsed and
      honored; rung results are computed against the PR head SHA.
- [x] Unreadable protection / no-checks-yet resolve to `pending` (fail closed),
      never to a spurious `pass`.
- [x] The DoD gate (0014) consumes the ladder result rather than re-querying
      checks itself.

## Implementation Checklist

- [x] Define the ladder types + `evaluateLadder()` in `core/src/gates/ladder.ts`;
      export from `core/index.ts`.
- [x] Add required-check discovery + check-run/status/review reads in
      `@looper/github` (`github/src/checks/`).
- [x] Add the `gates.ladder` schema + validation to `@looper/config` (reject
      `self_test`/`human` in `require`).
- [x] Wire 0014's DoD predicate to call `evaluateLadder`; remove any ad-hoc check
      lookups it had.
- [x] Surface `LadderResult` so the CLI (M16 · 0069) and merge loop can render
      rung-by-rung status.

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(in-memory GitHub from `@looper/testing`) — no real provider quota.

```bash
# replace with the repo's vitest invocation
# required checks green + review approved → mergeable:true, blockedBy:[]
# one required check failing/pending → mergeable:false, blockedBy:[ci]
# branch protection unreadable → ci:pending (fail closed), mergeable:false
# loop with deploy_smoke:false → deploy_smoke:not_applicable, excluded from mergeable
# self_test reported pass but ci failing → mergeable:false (self-test never gates)
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- Rung 2 binding: deterministic loops carry gates.required_checks; the
  runner's check gate (evaluateRequiredChecks) reads live check runs
  (green/red/waiting) — waiting releases the claim and retries next tick,
  red lands on the fallback or escalates.
- The merge DoD (decideMerge) composes rung 2 (required checks) + rung 3
  (standing approval) + the criteria attestation; deploy smoke is rung 4 via
  the deploy-smoke loop's checks.

## Risks / Rollback

The central risk is trusting a fakeable signal: if rung 2 ever reads a
provider-reported pass instead of the adopter's CI, the whole trust model
collapses. Mitigation — rung 2 reads only GitHub check-runs for the head SHA, and
`self_test`/`human` are structurally barred from `require`. Fail closed on every
ambiguity. Rollback: the ladder is additive behind the 0014 DoD gate; reverting
this task leaves the merge loop unable to compute `mergeable`, so it holds for a
human (safe default) rather than auto-merging.

## Final Summary

The ladder is wired as data: required checks per loop, check-gated
deterministic transitions, the DoD merge gate composing rungs 2-3, and the
smoke loop as rung 4 — all proven in the e2e merge/deploy path.
