# 0040 Adapter-Driven Build & Test

Status: planned  
Branch: task/0040-adapter-driven-build-test

## Goal

Make the implementation loop stack-agnostic: resolve the project adapter's
`build`/`test`/`lint` commands and weave them into the dispatched brief so the
provider sandbox runs them while producing the change — then treat the adopter's
own CI on the resulting PR as the trustworthy re-verification gate, independent of
where the work cell ran.

## Background

Part of [Milestone 09](../milestones/milestone-09-implementation-loop.md)
(Implementation Loop). Its Guiding Decisions require build/test to be "described
via the project adapter (stack-agnostic) and re-verified by the adopter's CI on
the PR." This task is the loop's *consumer* of the `ProjectAdapter` port defined
in [Milestone 06](../milestones/milestone-06-project-adapter-system.md) (interface
0024, auto-detect 0025, generic escape hatch 0026, bundled adapters 0027). See
[architecture](../../docs/architecture.md) "Execution model" (the work cell "runs
build/tests (provider-hosted)") and "Generic-ness, in three plugin systems"
(project adapters). It lands in `@looper/runtime` (brief composition + CI-gate
read) using the `ProjectAdapter` interface from `@looper/core` and the adapters in
`@looper/adapters`; the actual command execution happens in the provider sandbox
(brief) and the adopter's Actions (CI), not in controller code.

## Scope

- Resolve the effective adapter for the repo (explicit config override →
  auto-detect → generic), and read its `build`/`test`/`lint` command specs.
- Render those commands into the composed brief (with the work-cell self-test
  step the work cell 0037 dispatches), so the provider agent runs them in-sandbox
  before opening its PR.
- After ingest (0073), read the PR's required-check (CI) results via the GitHub
  port as the authoritative build/test verdict; surface it to the merge gate.
- Handle the "adapter has no command for X" and "CI re-runs differ from sandbox"
  cases without contradicting the trust boundary.

### Technical detail

**Adapter resolution.** A pure helper in `@looper/runtime/src/pipeline` calls
`@looper/adapters` `detect()` unless `looper.yml`/`loop.yml` pins an adapter; the
resolved `ProjectAdapter` (from `@looper/core` ports) exposes command specs:

```ts
interface CommandSpec { cmd: string; cwd?: string; env?: string[] /* names only */ }
interface ProjectAdapter {
  id: string;                       // "node" | "python" | "generic" | ...
  build?(): CommandSpec | null;
  test(): CommandSpec | null;       // the load-bearing one; null => no objective self-test
  lint?(): CommandSpec | null;
}
```

`resolveBuildTest(adapter)` returns `{ build, test, lint }`, each possibly `null`.
`env` carries *names only* — secret values live in the provider sandbox (Codex
strips them before the agent phase), never in the brief or run record.

**Brief rendering.** Inject a `## Build & Test` section into the composed brief
(the `prompt.md` template the work cell 0037 dispatches) listing the resolved
commands and the instruction to run them in-sandbox and ensure they pass before
opening the PR. When `test()` is `null`, render an explicit "no in-sandbox test
command configured — CI is the sole gate" note rather than omitting the section
(keeps the brief honest about weak self-test).

**CI as the trustworthy gate.** This is the load-bearing half: the sandbox run is
the *weakest* rung (may be quota- or network-limited under Codex). After 0073
correlates the PR, `readCiVerdict(github, pr)` reads the PR's required check runs
(`check_suite`/`status`) via `@looper/github` and returns
`{ status: passed|failed|pending, checks: [...] }`. The merge gate (M03 0014 /
review loop M10) consumes this; build/test "passing" for merge purposes means the
adopter's CI is green, regardless of the sandbox self-report. The controller makes
no model calls and runs no build/test itself — it reads results GitHub already
computed.

**Edge cases:** (a) adapter resolves to `generic` with empty commands → brief
notes no self-test, run record flags `selftest: none`; (b) sandbox passes but CI
fails → CI wins, item routes to the fix-and-revalidate sub-loop (M10), not merge;
(c) CI still pending at ingest → leave item in `in-review`, let the sweep (0076)
re-check on `check_suite` completion rather than blocking. Record the resolved
adapter id + command digests on the run record (0012) for tracing.

## Out Of Scope

- The `ProjectAdapter` interface, detection heuristics, and bundled-adapter impls
  (M06 · 0024–0027) — consumed here, not defined.
- Branch/PR creation and plan-contract posting (0039); the work-cell brief body
  and plan updates (0037); blast-radius guards (0038).
- The merge decision itself and intent-diff (M03 0014 / M10 0043) — this task only
  *supplies* the CI verdict to them.
- `deploy`/`run` adapter commands (deploy loop, M11).

## Acceptance Criteria

- [ ] Adapter resolution honors explicit config, then auto-detect, then generic,
      returning `build`/`test`/`lint` specs (each nullable).
- [ ] The composed brief contains a Build & Test section with the resolved
      commands and an in-sandbox "run before opening PR" instruction.
- [ ] A `null` test command renders an explicit "CI is sole gate" note, not an
      empty/omitted section.
- [ ] After ingest, the adopter's CI required-check result is read via the GitHub
      port and exposed as the build/test verdict to the merge gate.
- [ ] Sandbox-pass / CI-fail resolves in CI's favor (no merge; routes to fix loop).
- [ ] No build/test command is executed by controller code; no secret values
      appear in the brief or run record.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add `resolveBuildTest(adapter)` + config-override → detect → generic logic in
      `@looper/runtime/src/pipeline`.
- [ ] Extend brief composition to render the Build & Test section (incl. the
      null-test note).
- [ ] Add `readCiVerdict(github, pr)` over `@looper/github` required checks.
- [ ] Wire the verdict into the run record (0012) and expose it to the merge gate.
- [ ] Handle pending-CI (defer to sweep 0076) and sandbox≠CI divergence.
- [ ] Update docs if loop authoring/brief shape changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(`@looper/testing` fake-github + fake-backends) — no real provider quota.

```bash
# replace with the chosen stack's runner
# resolve: config-pin vs detect vs generic → correct specs
# render: brief contains resolved commands; null-test → "CI is sole gate" note
# verdict: fake PR with green/red/pending required checks → passed/failed/pending
# divergence: sandbox-pass + CI-fail → verdict=failed, no merge signal
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the adapter-resolution precedence, the brief Build & Test template shape,
the CI-verdict structure, and the rule that CI overrides the sandbox self-report.

## Risks / Rollback

The trust risk is treating the provider sandbox self-test as authoritative — it is
the weakest rung and may be skipped under Codex's secret-stripped/no-internet
agent phase. Mitigation: CI is always the gate of record; the sandbox run is
advisory. Rollback: if CI-verdict reading is flaky, fall back to leaving items in
`in-review` for the sweep (0076) to re-evaluate rather than merging on the sandbox
report.

## Final Summary

Fill this in before marking verified.
