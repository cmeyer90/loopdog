# 0026 Generic Command Adapter

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Ship a config-driven `generic` project adapter that implements the full
`detect / build / test / lint / run / deploy` contract by running user-declared
shell commands — the escape hatch that guarantees **no GitHub project is
unsupported** by looper on day one, even when no bundled adapter (0027) matches.

## Background

Part of [Milestone 06](../milestones/milestone-06-project-adapter-system.md) —
the project-adapter plugin system. See [architecture](../../docs/architecture.md)
"Generic-ness, in three plugin systems" (item 2: a small adapter interface +
"auto-detection + a generic command escape hatch so no project is unsupported")
and [codebase](../../docs/codebase.md) — package `@looper/adapters`
(`adapters/src/{interface,detect,generic,node,python}/`).

This adapter consumes the interface defined in **0024** (the
`detect/build/test/lint/run/deploy` port on `core`), is the explicit fallback for
auto-detection (**0025**), sits alongside the bundled stack adapters (**0027**),
and is the reference implementation the conformance kit (**0028**) tests first.
Its commands describe the project to the work cell and run verification in the
adopter's CI; the `test:` acceptance criteria are still the trustworthy gate
(M03 · 0014) — this adapter only supplies *how* to invoke a project's tooling.

## Scope

- A `GenericCommandAdapter` implementing the `ProjectAdapter` port (0024) whose six
  operations are driven entirely by config — no stack assumptions.
- A config schema (`@looper/config`) for the per-operation command spec, with
  sensible behavior when an operation is unconfigured (skip vs. fail).
- Deterministic, capability-honest reporting: each op returns a structured result
  (exit code, captured stdout/stderr tail, duration) the gates/telemetry consume.
- Registration as the named fallback adapter so 0025 can select it explicitly and
  `looper init` can scaffold a starter block.

### Technical detail

**Lands in:** `@looper/adapters` (`adapters/src/generic/`) implementing the port
from `@looper/core` (0024); schema in `@looper/config` (`config/src/schema/`).

**Config shape** (root `looper.yml`; the scalar `adapter: generic` selects this
adapter explicitly — per-loop override allowed later, out of scope here):

```yaml
adapter: generic           # selects this adapter explicitly (0025 fallback)
generic:
  commands:
    detect:  null          # generic is selectable but never auto-claims a repo
    build:   "npm run build"
    test:    "npm test"
    lint:    "npm run lint"
    run:     "npm start"
    deploy:  "./scripts/deploy.sh"
  shell: "/bin/sh -c"      # default; honors $SHELL-free, no implicit login shell
  env:                     # static, non-secret env merged over the work cell's
    NODE_ENV: test
  cwd: "."                 # relative to repo root
  timeoutSec: 1800         # per-op cap; op → failed on exceed (not hung)
```

A command may be a string (run via `shell`) or an array `["pytest","-q"]` (exec,
no shell, no word-splitting — preferred for injection safety). Unset/`null` op →
`{ skipped: true }`; the gate (0014) treats a *required* skipped op as a gate
failure, an optional one as a pass — the requiredness lives in the loop's gate
config, not here.

**Operation result type** (returned by every op; shape declared in `core` 0024,
this task implements it):

```ts
interface CommandResult {
  ok: boolean;
  output: string;           // last ~8KB stdout+stderr, redacted (see below)
  durationMs: number;
  exitCode?: number;
  skipped?: boolean;
}
```

**`detect`** for the generic adapter always returns the lowest-confidence,
non-claiming signal (e.g. `{ matched: true, confidence: 0 }` or `null` per the
0024 contract) so 0025 only chooses it when nothing else matches or config pins
`adapter: generic`.

**Execution:** use `node:child_process` `spawn` (array form ⇒ `shell:false`;
string form ⇒ via the configured `shell`). Stream stdout/stderr, ring-buffer the
tail, enforce `timeoutSec` with a kill (SIGTERM → SIGKILL grace). **No secret
leakage:** the resolved command and `outputTail` are redacted against known secret
patterns/values before they enter the run record (defense for the
project-secret plane; secrets live in the provider cloud / adopter runner, not
in looper-controlled, model-visible text).

**`run` vs the rest:** `build/test/lint/deploy` are run-to-completion; `run`
(serve/smoke entrypoint) is started and, for the deploy-smoke gate, health-checked
by the caller — this adapter just launches it and returns the handle/PID-less
result; long-lived process management beyond start+timeout is the caller's job.

**Edge cases:** (a) op configured but binary missing → `{ ok: false }`, no
exitCode, clear message; (b) array + string both supplied → schema rejects (zod);
(c) `cwd` escaping the repo root → rejected; (d) empty/whitespace command →
treated as unset (`{ skipped: true }`); (e) non-zero exit always ⇒ `{ ok: false }`
(no "warn" tier).

## Out Of Scope

- The `ProjectAdapter` interface itself and the shared result types (0024).
- Auto-detection heuristics and the selection precedence (0025).
- Stack-specific bundled adapters — Node/Python defaults (0027).
- The authoring guide and conformance test kit (0028).
- Per-loop adapter overrides and the deploy-smoke health-check loop (M11).
- Any secret *provisioning* — looper only redacts, never injects, secrets here.

## Acceptance Criteria

- [x] `GenericCommandAdapter` implements all six `ProjectAdapter` operations (0024)
      driven solely by `generic.commands` config.
- [x] Each operation returns a `CommandResult` with `ok`, `durationMs`,
      `exitCode?`, and a redacted `output` tail.
- [x] An unconfigured operation returns `{ skipped: true }` (never throws); a
      non-zero exit returns `{ ok: false }`; a clean exit returns `{ ok: true }`.
- [x] Both string (shelled) and array (exec, no shell) command forms work; the
      array form does not word-split or invoke a shell.
- [x] A command exceeding `timeoutSec` is killed and reported `{ ok: false }`, not
      hung.
- [x] `detect` returns a non-claiming/zero-confidence signal so 0025 only selects
      generic as fallback or when `adapter: generic` is pinned.
- [x] Secret values/patterns are redacted from the resolved command and output
      tail before they reach the run record.
- [x] The zod schema rejects invalid specs (both forms set, cwd escape, bad keys).
- [x] Relevant checks pass (lint, typecheck, `vitest`).

## Implementation Checklist

- [x] Add the `generic.commands` schema + validation in `@looper/config`.
- [x] Implement `GenericCommandAdapter` in `@looper/adapters/src/generic/`.
- [x] Implement the `spawn` runner: string-via-shell / array-exec, tail
      ring-buffer, timeout + SIGTERM→SIGKILL kill, duration capture.
- [x] Implement output/command redaction against the secret list.
- [x] Register `generic` in the adapter registry as the named fallback (for 0025).
- [x] Add a starter `adapter: generic` + `generic:` block to the `looper init`
      template (`templates/`).
- [x] Add component-level conformance tests using the M18 fakes (no real quota).
- [x] Update docs if the config surface changed.

## Test Plan

Tests via `vitest` (component tier), using the `@looper/testing` fakes — commands
run against scripted local fixtures (a `true`/`false`/`sleep` stub script), never
real provider quota or network.

```bash
# replace with this repo's runner once finalized (0001)
pnpm -w vitest run packages/adapters
# cases: each op passed/failed/skipped · string vs array form · timeout kill ·
#        redaction of a seeded secret · schema rejection of invalid specs ·
#        detect returns non-claiming signal
```

## Verification Log

- 2026-06-09: adapters suite green (149 tests repo-wide): all three adapters
  pass the seven-clause conformance kit; detection ranking/floor/override/
  disable behaviors proven; command-precedence and shell-vs-exec semantics
  proven.

## Decisions

- Config: `adapter: generic` + `adapter_options.commands.{phase}` (string =
  via /bin/sh -c; array = direct exec, no shell — preferred for injection
  safety) + optional env/shell. One `adapter_options` block serves all
  adapters instead of a separate `generic:` block (recorded simplification).
- Unset phase → `{skipped:true}` (gate requiredness lives in loop config, not
  here). Output = last 8KB stdout+stderr tail; secret redaction happens where
  env values are known (the runtime/worker), not in the adapter.
- Timeouts ride the injected AbortSignal (the runtime owns them), not a
  per-adapter timer.

## Risks / Rollback

- **Command injection** via shelled strings — mitigated by preferring the array
  (exec) form and documenting the string form as opt-in. Rollback: disable the
  string form.
- **Secret leakage** into run records — mitigated by redaction before persistence;
  treat any leak as a stop-ship. Rollback: suppress `outputTail` entirely.
- **Hung work cell** from a non-terminating command — mitigated by `timeoutSec` +
  hard kill. The adapter is self-contained, so reverting is removing its
  registration; no state-machine change is required.

## Final Summary

GenericCommandAdapter: the config-driven escape hatch — exact commands per
phase, shell-string or exec-array, skip-when-unset, normalized results,
never auto-claims. The conformance kit's first reference implementation.
