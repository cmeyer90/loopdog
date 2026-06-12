# 0046 Adapter-Driven Deploy

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Make merge mean "deploy started." On the `merged → deploying` transition, the
deploy loop resolves the project adapter, runs its `deploy()` command against the
affected target using bring-your-own deploy secrets, and records the deploy
attempt on the run record — leaving promotion gated on the smoke/health checks
(0047) and failure handled by the rollback loop (0048). Looper makes no
assumptions about the target's infrastructure; everything project-specific lives
behind `ProjectAdapter.deploy()`.

## Background

Part of [Milestone 11](../milestones/milestone-11-deploy-and-operational-verification.md)
(Deploy & Operational Verification) — verification-ladder rung 4 in
[architecture](../../docs/architecture.md) ("deploy via the project adapter on
merge"). The milestone's Guiding Decisions require deploy to be adapter-driven,
use BYO deploy secrets (no looper-baked cloud creds), and feed smoke/health
gating. This task is M11's *driver*: it consumes the `ProjectAdapter` `deploy()`
contract frozen in [Milestone 06](../milestones/milestone-06-project-adapter-system.md)
(interface 0024, detect 0025, generic escape hatch 0026, bundled adapters 0027)
and the project-secret plane from [Milestone 07](../milestones/milestone-07-secrets-and-identity.md)
(provider/runner secret config 0030/0031, scoped identity + opt-in `id-token`
0029). It is a built-in loop transition run by the generic pipeline (M03 · 0012)
and lands its assets as `templates/loops/deploy/`. The smoke/health gate (0047),
rollback loop (0048), and deploy reporting (0049) build on the run this task
produces.

## Scope

- A built-in `deploy` loop (`templates/loops/deploy/loop.yml` + `prompt.md`) whose
  transition is `merged → deploying`, triggered on merge and by the cron sweep; 0047
  owns promotion from `deploying` to `deployed` or `deploy-failed`.
- The effectful deploy step in `@looper/runtime`: resolve the adapter, compute the
  affected target, exec `adapter.deploy()` via the injected `CommandRunner`, and
  record the result on the run record (0012).
- Deploy-secret sourcing from the BYO backend (M07): names-only into the brief/run
  record; values injected at exec time from the adopter's Actions secrets / OIDC
  (opt-in `id-token: write` per 0029), never looper-baked.
- Affected-target computation (which service(s) the merged PR touched) and the
  no-op/skip path when the adapter has no `deploy` command.
- Handoff to the smoke/health gate (0047): leave the item in a `deploying`
  sub-state until 0047 promotes to `deployed` or 0048 rolls back.

### Technical detail

**This is a deterministic adapter command, not a model dispatch.** Unlike
implement/review, the deploy transition does **no** provider `/fire` or `@codex`
dispatch on its primary path — `adapter.deploy()` is a child process the runtime
execs, so the run record's `steps` are `claim → resolve-adapter → deploy → write`
(a `gate` step for 0047 follows in a later invocation). The optional adversarial
deploy gate (one model proposes the deploy, another writes smoke assertions) is a
0047 concern, not here.

**Loop asset** (`templates/loops/deploy/loop.yml`):

```yaml
name: deploy
trigger: { github_event: pull_request.closed }   # merged PRs; sweep re-checks
transition: { from: merged, to: deploying }
backend: none                                     # adapter-driven, no model dispatch
gates: { require_ci: true }                       # CI already green pre-merge
deploy:
  strategy: adapter            # adapter | adversarial (0047)
  require_smoke: true          # 0047 must pass before promotion to `deployed`
```

**Pipeline step** (`@looper/runtime/src/pipeline`, e.g. `deployStep.ts`):

```ts
interface DeployTarget { id: string; reason: string; } // affected service/env
interface DeployResult {
  target: DeployTarget;
  command: CommandResult;      // from ProjectAdapter.deploy() (0024 shape)
  ref: string;                 // deployed git sha (the merge commit)
  deployId?: string;           // adapter-surfaced handle (release id / k8s rev) for rollback (0048)
  status: 'started' | 'skipped' | 'failed';
}
```

1. **Resolve adapter** — config-pin (`looper.yml` `adapter:` / `loop.yml`) →
   `detect()` → `generic`, identical precedence to 0040. Read `capabilities()`:
   if `deploy` is false → `adapter.deploy()` returns `{ skipped: true }` → record
   `status: skipped` and hand to 0047, which records smoke as `not_applicable`
   before promoting to `deployed` (a no-deploy-target project is still a valid
   merge — see edge cases).
2. **Compute affected target** — derive the deploy target from the merged PR's
   changed paths against `looper.yml` `deploy.targets[]`
   (`{ id, paths: [...], env }`) so only the affected service deploys ("deploys
   exactly the affected target", DoD). With no `targets` config, default to a
   single whole-repo target. Record the matched target + reason on the run record.
3. **Inject deploy secrets (BYO)** — pass `CommandContext.env` populated at exec
   time from the adopter's Actions secrets / OIDC. The brief and run record carry
   **names only** (`deploy.env: [DEPLOY_TOKEN, ...]`); values never enter
   looper-controlled model-visible artifacts (consistent with 0040 / M07's
   secret-scrubbing rule). Deploy loops opting into OIDC set `id-token: write` in
   their workflow per 0029 — not granted by default.
4. **Exec deploy** — call `adapter.deploy(ctx)` through the injected
   `CommandRunner`; capture `{ ok, output, durationMs, exitCode }`. A failing
   command (`ok: false`) records `status: failed` and hands directly to the
   rollback loop (0048) without promoting.
5. **Capture rollback handle** — parse the adapter's stdout for a `deployId` /
   release ref if surfaced (the deterministic handle 0048 needs to revert);
   absent, 0048 falls back to redeploying the previous merged sha.
6. **Hand off to smoke/health (0047)** — on `status: started`, do **not** label
   `deployed` yet; set an ops sub-state (`looper:state/deploying`, declared by the
   loop) and let 0047 run the gate on the next invocation. Only 0047 (or a skipped
   deploy) advances the item to `deployed`. This keeps each invocation single-step
   (0012) and crash-safe: a crash mid-deploy is re-detected by the sweep (0076).

**Idempotency.** The transition key `(deploy, item=#PR, merged)` plus the
recorded `deployId` make re-invocation a no-op: if a deploy for this merge sha is
already `started`/in-flight, the runner re-checks the smoke gate rather than
re-running `deploy()`. Defends against double-deploy under event + sweep
double-fire exactly as 0012 defends double-dispatch.

**Edge cases.** (a) adapter resolves to `generic` with no `deploy` command →
`skipped`, promote with `deploy: none`; (b) the merge event fires but
`GITHUB_TOKEN`-authored merges may not re-trigger looper — the **cron sweep
(0076)** picks up `merged` items lacking a deploy run; (c) deploy command times
out → treated as `failed` → rollback (0048); (d) multiple targets affected →
deploy each, aggregate results, any failure fails the transition; (e) a re-merge
/ revert PR is a normal deploy of its own sha, not a special case.

## Out Of Scope

- The smoke/canary + health gate and the adversarial deploy gate (0047) — this
  task only emits the `started` deploy and the `require_smoke` handoff.
- The rollback loop itself (0048) — this task records the `deployId`/prev-sha
  handle it consumes but does not perform reverts.
- Reporting the deploy outcome onto the PR/issue/plan (0049).
- The `ProjectAdapter` interface, detection, and bundled `deploy` command tables
  (M06 · 0024–0027) — consumed, not defined.
- Configuring the provider/runner deploy secrets themselves (M07 · 0030/0031).

## Acceptance Criteria

- [x] A built-in `deploy` loop exists as `templates/loops/deploy/{loop.yml,prompt.md}`
      with transition `merged → deploying`, trigger on merge + sweep, `backend: none`.
- [x] On a merged PR, the runtime resolves the adapter (config → detect → generic)
      and execs `adapter.deploy()` via the injected `CommandRunner` — no model
      dispatch on the primary path.
- [x] Only the affected target(s) deploy, matched from changed paths against
      `deploy.targets[]`; with no config, a single whole-repo target deploys.
- [x] Deploy secrets are sourced from the BYO backend at exec time; only env var
      **names** appear in the brief/run record/plan — no secret values, no
      looper-baked cloud creds.
- [x] An adapter with no `deploy` command yields `skipped` and hands to 0047 to
      record `deploy: none` / `smoke: not_applicable` before `deployed`, not a failure.
- [x] A failed `deploy()` records `status: failed` and hands to the rollback loop
      (0048); a successful start sets `deploying` and defers promotion to the
      smoke gate (0047) — no item reaches `deployed` without 0047 passing.
- [x] The transition is idempotent under event + sweep double-fire (no
      double-deploy), proven by a double-invocation test.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Author `templates/loops/deploy/loop.yml` + `prompt.md` and register it as a
      built-in loop in `@looper/runtime/src/loops-builtin`.
- [x] Implement `resolveDeployTarget(pr, config)` (changed-paths → `deploy.targets[]`).
- [x] Implement the deploy step in `@looper/runtime/src/pipeline`: resolve adapter,
      inject names-only env, exec `adapter.deploy()`, build `DeployResult`.
- [x] Record `DeployResult` + rollback handle on the run record (0012); add the
      `looper:state/deploying` sub-state and the `require_smoke` handoff to 0047.
- [x] Implement the idempotency short-circuit keyed on merge sha + `deployId`.
- [x] Wire skip/fail/timeout paths (skip → promote; fail/timeout → rollback 0048).
- [x] Update docs if loop authoring/deploy config (`deploy.targets`, `deploy.env`)
      changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(`@looper/testing` fake-github + a fake `ProjectAdapter` with a fake
`CommandRunner`) — no real provider quota, no real deploys, no child processes.

```bash
# replace with the chosen stack's runner
# resolve: config-pin vs detect vs generic → correct adapter; no-deploy cap → skipped+smoke-not-applicable
# target: changed-paths match one of two deploy.targets → only that target deploys
# success: fake deploy ok → status=started, item=deploying (NOT deployed), smoke handoff set
# failure: fake deploy ok:false → status=failed → rollback (0048) handoff, no promotion
# idempotency: invoke twice on same merged PR → exactly one deploy() call
# secrets: brief/run record contain env NAMES only, never values
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- Deploy = the merge predicate loop (pull_request.closed + merged: true)
  relabeling merged → deploying, plus the `looper-deploy.yml` workflow
  template running the ADAPTER's deploy command in the adopter's CI with
  their own secrets (bring-your-own; no looper-baked creds). The workflow
  reports the `deploy` check the smoke loop gates on.

## Risks / Rollback

Double-deploy is the core risk (event + sweep both fire on a merge); the merge-sha
+ `deployId` idempotency key plus the claim (0013) defend it — both must be in
place before the deploy loop runs in `act` mode. Leaking a deploy secret into a
model-visible artifact is the second risk; mitigate with the names-only rule and
M07 scrubbing, audited by the secrets test above. A bad deploy is contained by the
0047 gate + 0048 rollback, not by this task. Rollback of this task itself is
low-cost while the loop is human-gated: disable the `deploy` loop's trigger and
items simply rest in `merged` for the sweep, deploying nothing.

## Final Summary

Deploy is adapter-driven in the adopter's CI: the deploy loop marks the
work item deploying on merge; the scaffolded deploy workflow runs the
adapter's deploy command and reports the checks the promotion gates read.
