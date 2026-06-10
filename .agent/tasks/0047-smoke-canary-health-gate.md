# 0047 Smoke/Canary & Health Gate

Status: planned  
Branch: task/0047-smoke-canary-health-gate

## Goal

Make "deployed" mean "deployed and healthy": after the adapter-driven deploy
(0046) runs, execute the project adapter's smoke/canary + health assertions
against the live target, resolve them to a single pass/fail verdict, publish it as
the `deploy_smoke` ladder rung (M10 · 0041), and feed it into the merge/promotion
DoD (M03 · 0014) — so a deploy is not "successful" until operational checks pass,
and a failure arms the rollback loop (0048).

## Background

Part of [Milestone 11](../milestones/milestone-11-deploy-and-operational-verification.md)
(Deploy & Operational Verification). The milestone's Definition-of-Done states "a
deploy is not successful until smoke/canary + health checks pass" and that a failed
check "triggers automatic rollback." This task is the gate that produces that
verdict. It is the **rung-4 producer** for the verification ladder — see
[architecture](../../docs/architecture.md) "The verification ladder (trust)" (rung
4: deploy-time smoke/canary + health checks → auto-rollback) and "Deploy &
operational verification." Assertions are described by the project adapter
(`ProjectAdapter`, M06), so looper makes no assumptions about the target's infra;
looper reads results, it does not invent checks. Lands in `@looper/runtime`
(the gate pipeline + brief/check wiring) consuming the `ProjectAdapter` port from
`@looper/core` and adapter impls in `@looper/adapters`; the ladder slot it fills is
defined in 0041, and the deploy it follows is 0046.

## Scope

- Resolve the adapter's `smoke`/`health` command specs and an optional canary
  policy; run or resolve them against the just-deployed target after 0046 reports
  `started` or `skipped`.
- Resolve the raw results to a typed `SmokeResult` verdict (pass / fail / pending /
  not_applicable), with per-assertion detail and the deploy/run handle.
- Publish the verdict as the `deploy_smoke` rung: a GitHub check-run on the merge
  commit + a `smoke` artifact on the run record (0012), so 0041's
  `evaluateLadder()` resolves rung 4 from GitHub state, not a provider self-report.
- Feed the verdict into the DoD/promotion gate (0014): when the loop sets
  `deploy_smoke: true`, an un-passed gate blocks promotion of the deploy.
- On a `fail` verdict, emit the failure signal the rollback loop (0048) triggers on
  (a `looper:state/deploy-failed` label + run-record `outcome.status: failed`).
- The optional adversarial deploy gate hook: allow smoke assertions to be authored
  by a second provider (one model proposes the deploy, another writes the smoke
  assertions) for `tier:core` / high-risk targets.

### Technical detail

**Package & placement.** The gate orchestration is IO + composition →
`@looper/runtime` (`runtime/src/deploy/smoke.ts`), invoked by the transition runner
(0012) on the deploy loop's post-deploy step. The `SmokeResult` type is pure
domain → `@looper/core` (`core/src/run-record/` alongside the deploy verdict
types). Adapter `smoke`/`health`/canary command specs extend the `ProjectAdapter`
port in `@looper/core/ports`; impls live in `@looper/adapters`. Check-run
publishing is IO → `@looper/github` (`github/src/checks/`). The `gates.deploy_smoke`
+ canary config schema lands in `@looper/config`. **No controller code executes the
target's commands directly** — they run in the adopter's Actions deploy job (the
same place 0046 runs the deploy) or the provider sandbox; looper reads the results.

**Adapter surface (extends the M06 port):**

```ts
interface SmokeSpec {
  smoke?(): CommandSpec | null;   // assertions vs the live target (curl/health probe/e2e)
  health?(): CommandSpec | null;  // liveness/readiness probe(s)
}
interface CanaryPolicy {
  percent: number;                // % traffic to canary before full promotion (0 => no canary)
  bake_seconds: number;           // observation window before resolving
  metrics?: string[];             // adapter-named SLI gates (error_rate, p95_latency)
}
```

`env` carries **names only** — deploy secrets come from bring-your-own backend
(M07), never the brief or run record. When `smoke()` is `null`, the gate resolves
`not_applicable` and records it explicitly (honest about a weak rung), never a
spurious `pass`.

**Verdict type (`@looper/core`):**

```ts
type SmokeStatus = 'pass' | 'fail' | 'pending' | 'not_applicable';
interface SmokeResult {
  deploy: { target: string; commit: string; gh_run?: number };
  status: SmokeStatus;
  assertions: { name: string; status: SmokeStatus; detail: string }[];
  canary?: { percent: number; baked_seconds: number; promoted: boolean };
  evidence: { checkRunId?: number; logsUrl?: string };
}
```

`status` is `pass` iff every assertion + (if configured) the canary bake concluded
`pass`; `fail` on any failure; `pending` while the bake window is open or results
are not yet reported. The result is **only valid for `deploy.commit`** — a new
deploy invalidates a prior verdict.

**Flow (runner post-deploy step).** After 0046 moves the item to
`looper:state/deploying`: (1) resolve the effective adapter (config-pin → detect →
generic, same precedence as 0040) and its `SmokeSpec` + `CanaryPolicy`; (2) if a
canary policy is set, the deploy targeted the canary slice — wait out
`bake_seconds` via the **cron sweep** (0076), not an in-process sleep, so the run
stays short and crash-safe; (3) read smoke/health results from the Actions deploy
job's check-runs/outputs via `@looper/github`; (4) build `SmokeResult`; (5)
publish a `looper/deploy-smoke` check-run on the merge commit + attach the `smoke`
artifact to the run record (0012); (6) route by status (below). The bake/`pending`
case **defers to the sweep** for re-evaluation rather than blocking.

**Ladder + DoD wiring.** This task is the **producer** for rung 4; 0041 reads it.
`evaluateLadder()` resolves `deploy_smoke` from the `looper/deploy-smoke` check-run
(primary) or the run-record `smoke` artifact (backup). The DoD gate (0014) already
treats "deploy smoke passed (if the loop deploys)" as part of doneness; a loop
opts in via `loop.yml`:

```yaml
gates:
  deploy_smoke: true            # promotes the deploy_smoke rung to required
  canary: { percent: 10, bake_seconds: 300, metrics: [error_rate] }
```

Default `deploy_smoke: false` (rung 4 `not_applicable`); the risk-tier policy
(0045) may tighten it but never relaxes rung 2 (CI).

**Routing.** A `pass` or explicit `not_applicable` verdict moves the item from
`looper:state/deploying` to `looper:state/deployed`. A `pending` verdict leaves it
in `deploying` for the sweep to re-check. A `fail` verdict sets
`outcome.status: failed` on the run record and applies the
`looper:state/deploy-failed` label — the **trigger the rollback loop (0048)
consumes**. Because this is a controller→controller handoff that `GITHUB_TOKEN`
won't re-trigger, the **cron sweep (0076)** carries it to the rollback loop on the
next tick (an optional PAT makes it instant). The gate does not itself roll back —
it arms 0048.

**Adversarial deploy gate (optional, high-risk).** When `loop.yml` sets
`smoke.adversarial: true`, the smoke assertions are authored by a **different
provider** than the one that deployed (dispatched like the cross-model review
0042, via the backend port) and merged into the adapter's smoke command before the
run. Off by default; intended for `tier:core` targets.

**Edge cases (fail closed):** (a) adapter has no `smoke`/`health` →
`not_applicable`, recorded, not silently passed; (b) results not yet reported when
the runner checks → `pending`, sweep re-checks on `check_suite` completion, never
`fail`; (c) deploy succeeded but smoke fails → `fail` + rollback handoff, deploy is
**not** promoted; (d) canary bake still open → `pending` until the sweep observes
the window elapsed; (e) flapping/partial-success assertions → any non-pass
assertion makes the verdict non-pass (no "mostly green"); (f) a `fail` whose
rollback also fails → escalate via stuck-detection (M12 · 0051), do not loop.

## Out Of Scope

- The deploy execution itself + secret sourcing (0046, M07); the `ProjectAdapter`
  base interface + detection (M06 · 0024–0027) — consumed here, not defined.
- The rollback action + health re-verification (0048) — this task only *arms* it.
- Deploy outcome reporting to PR/issue/plan (0049) — consumes this verdict.
- The ladder model + `evaluateLadder()` (0041) and the DoD predicate (0014) — this
  task produces the rung/verdict they read, it does not redefine them.
- The auto-merge/tier decision (M10 · 0045).

## Acceptance Criteria

- [ ] After 0046 moves an item to `looper:state/deploying`, the adapter's
      `smoke`/`health` commands are resolved and their results read from GitHub
      Actions state — no target command is executed by controller code.
- [ ] A typed `SmokeResult` is produced and attached to the run record (0012), and
      a `looper/deploy-smoke` check-run is published on the merge commit.
- [ ] `evaluateLadder()` (0041) resolves the `deploy_smoke` rung from that check-run
      / artifact; `mergeable`/promotion blocks when `deploy_smoke: true` and the
      verdict is not `pass`.
- [ ] A `fail` verdict sets `outcome.status: failed` and applies
      `looper:state/deploy-failed`, arming the rollback loop (0048) via the sweep.
- [ ] No `smoke`/`health` command → `not_applicable` recorded explicitly (not a
      spurious pass) and the item advances to `deployed`; results-not-yet-reported
      → `pending` (sweep re-checks while the item remains `deploying`).
- [ ] A canary policy defers the verdict over `bake_seconds` via the sweep, not an
      in-process sleep, and resolves `pass` only after the bake completes cleanly.
- [ ] No deploy secret values appear in the brief or run record (names only).
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Extend the `ProjectAdapter` port with `smoke()`/`health()` + `CanaryPolicy`
      in `@looper/core/ports`; add the `SmokeResult` type in `core/src/run-record/`.
- [ ] Implement `runSmokeGate()` in `@looper/runtime/src/deploy/smoke.ts` (resolve
      adapter → read results → build verdict → route by status).
- [ ] Publish the `looper/deploy-smoke` check-run via `@looper/github`
      (`github/src/checks/`) and attach the `smoke` run-record artifact.
- [ ] Add `gates.deploy_smoke` + `gates.canary` + `smoke.adversarial` schema to
      `@looper/config` (default `deploy_smoke: false`).
- [ ] Wire the `fail` path to apply `looper:state/deploy-failed` (0048 trigger) and
      the `pending`/bake path to defer to the sweep (0076).
- [ ] Wire the optional adversarial-assertion dispatch through the backend port.
- [ ] Update docs if loop authoring / `loop.yml` gate keys changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(`@looper/testing` fake-github + fake-adapter) — no real provider quota or live
target.

```bash
# replace with the repo's vitest invocation
# all smoke assertions green → SmokeResult.status=pass, check-run success, rung 4 pass
# one assertion fails → status=fail, deploy-failed label applied, rollback armed
# adapter has no smoke()/health() → not_applicable recorded (not a spurious pass)
# results not reported yet → pending, sweep re-check (no premature fail)
# canary bake open → pending until sweep observes bake_seconds elapsed
# deploy_smoke:true + non-pass verdict → DoD/promotion blocked
# secret env names only → no secret values in brief/run record
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the `SmokeResult` schema, the `smoke`/`health`/canary adapter surface, the
sweep-driven bake-deferral mechanism, the rung-4 publishing channel (check-run vs
artifact precedence), and the `deploy-failed` → rollback handoff convention.

## Risks / Rollback

The trust risk is treating a provider/sandbox-reported smoke pass as authoritative,
or passing when no assertions ran — both let an unhealthy deploy promote.
Mitigation: the verdict is computed from GitHub-side deploy-job results, missing
assertions resolve `not_applicable` (never silent pass), and every ambiguity fails
closed to `pending`/`fail`. Second risk: an in-process bake wait would block the
short-run guarantee and lose work on crash — mitigated by deferring bake to the
sweep (0076). Rollback: the gate is additive behind `deploy_smoke: false`; with it
off, deploys promote on rung 2/3 alone (pre-0047 behavior), so reverting this task
degrades safely rather than blocking all deploys.

## Final Summary

Fill this in before marking verified.
