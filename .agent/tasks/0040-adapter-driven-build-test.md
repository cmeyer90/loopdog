# 0040 Adapter-Driven Build & Test

Status: verified  
Branch: claude/laughing-johnson-8a7944

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
(project adapters). It lands in `@loopdog/runtime` (brief composition + CI-gate
read) using the `ProjectAdapter` interface from `@loopdog/core` and the adapters in
`@loopdog/adapters`; the actual command execution happens in the provider sandbox
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

**Adapter resolution.** A pure helper in `@loopdog/runtime/src/pipeline` calls
`@loopdog/adapters` `detect()` unless `loopdog.yml`/`loop.yml` pins an adapter; the
resolved `ProjectAdapter` (from `@loopdog/core` ports) exposes command specs:

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
(`check_suite`/`status`) via `@loopdog/github` and returns
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

- [x] Adapter resolution honors explicit config, then auto-detect, then generic,
      returning `build`/`test`/`lint` specs (each nullable).
- [x] The composed brief contains a Build & Test section with the resolved
      commands and an in-sandbox "run before opening PR" instruction.
- [x] A `null` test command renders an explicit "CI is sole gate" note, not an
      empty/omitted section.
- [x] After ingest, the adopter's CI required-check result is read via the GitHub
      port and exposed as the build/test verdict to the merge gate.
- [x] Sandbox-pass / CI-fail resolves in CI's favor (no merge; routes to fix loop).
- [x] No build/test command is executed by controller code; no secret values
      appear in the brief or run record.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add `resolveBuildTest(adapter)` + config-override → detect → generic logic in
      `@loopdog/runtime/src/pipeline`.
- [x] Extend brief composition to render the Build & Test section (incl. the
      null-test note).
- [x] Add `readCiVerdict(github, pr)` over `@loopdog/github` required checks.
- [x] Wire the verdict into the run record (0012) and expose it to the merge gate.
- [x] Handle pending-CI (defer to sweep 0076) and sandbox≠CI divergence.
- [x] Update docs if loop authoring/brief shape changed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(`@loopdog/testing` fake-github + fake-backends) — no real provider quota.

```bash
# replace with the chosen stack's runner
# resolve: config-pin vs detect vs generic → correct specs
# render: brief contains resolved commands; null-test → "CI is sole gate" note
# verdict: fake PR with green/red/pending required checks → passed/failed/pending
# divergence: sandbox-pass + CI-fail → verdict=failed, no merge signal
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- The brief carries the adapter's commands: ComposeContext.adapter.testCmd
  ({{adapter.test_cmd}} placeholder) — the work cell runs what the adopter's
  CI runs. The adopter's CI re-verifies on the PR (rung 2) via required
  checks the merge DoD reads (gates.required_checks: [lint, test, build]).
- Detect-driven seeding of testCmd into the controller compose path uses the
  M06 registry (describe().commands.test).

## Risks / Rollback

The trust risk is treating the provider sandbox self-test as authoritative — it is
the weakest rung and may be skipped under Codex's secret-stripped/no-internet
agent phase. Mitigation: CI is always the gate of record; the sandbox run is
advisory. Rollback: if CI-verdict reading is flaky, fall back to leaving items in
`in-review` for the sweep (0076) to re-evaluate rather than merging on the sandbox
report.

## Final Summary

Build/test is adapter-described, sandbox-executed, and CI-re-verified: the
brief tells the work cell the project's real commands, and the merge gate
trusts only the adopter's required checks — independent of where the work
cell ran.
