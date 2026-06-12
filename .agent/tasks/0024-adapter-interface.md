# 0024 Adapter Interface

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Define the one project-adapter contract — `detect / build / test / lint / run /
deploy` — that lets looper describe and operate an arbitrary project. The
interface lives in `@looper/core` (a port); implementations live in
`@looper/adapters`. Every command returns a normalized
`{ ok, output, durationMs }` result so the controller treats all stacks uniformly.

## Background

Part of [Milestone 06](../milestones/milestone-06-project-adapter-system.md) — the
second of looper's three plugin systems ([architecture](../../docs/architecture.md)
"Generic-ness, in three plugin systems"). Without this contract, "any GitHub
project" is false: the controller cannot run verification in the adopter's CI,
compose a brief that tells the work cell how to build/test, or deploy on merge.
`ProjectAdapter` is one of the five `@looper/core` ports listed in
[codebase](../../docs/codebase.md) (Packages table) and stubbed by the port task
(0094); this task fills in its real shape. It is a sibling of the execution-backend
interface (0019) and follows the same "small uniform contract + capability
metadata + conformance kit" pattern. Auto-detect (0025) and the generic command
escape hatch (0026) are the first two implementations; bundled adapters (0027) and
the authoring guide + test kit (0028) build on the contract frozen here.

## Scope

- The `ProjectAdapter` interface in `@looper/core`: the six lifecycle methods plus
  `detect()` and capability/metadata.
- The normalized command result type `{ ok, output, durationMs }` returned by every
  lifecycle method, and the input shape (workspace dir + structured options).
- How `detect()` (0025) selects an adapter and how the generic command adapter
  (0026) plugs in as the always-available fallback.
- A thin `CommandRunner` injection point so adapters describe *what* to run while
  `@looper/runtime` owns *how* (child-process exec) — keeping `core` IO-free.

### Technical detail

Lands in `@looper/core/src/ports/` (interface + result types) and is implemented in
`@looper/adapters/src/{interface,detect,generic,node,python}/`.

**Result + command shapes** (`@looper/core`):

```ts
interface CommandResult {
  ok: boolean;            // exit code 0 (or adapter-defined success)
  output: string;         // combined stdout+stderr, captured for the run record / brief
  durationMs: number;     // wall-clock, for telemetry (M12)
  exitCode?: number;      // raw code when a process ran; absent for no-op/skip
  skipped?: boolean;      // adapter has no command for this phase (e.g. no deploy)
}

interface CommandContext {
  workdir: string;        // absolute path to the checked-out repo
  env?: Record<string, string>;
  run: CommandRunner;     // injected exec; adapters never spawn directly
  signal?: AbortSignal;   // cancellation / timeout from the runner
}

type CommandRunner = (
  argv: string[], opts: { cwd: string; env?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;

// Read-only repo view declared in @looper/core and injected into detect(); keeps
// the port IO-free (no real fs / no workdir:string) — the runtime supplies the impl.
interface RepoFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(dir: string): Promise<string[]>;
}
```

**The interface** (`@looper/core`):

```ts
interface ProjectAdapter {
  readonly name: string;                 // "node" | "python" | "generic" | "<third-party>"
  detect(repo: RepoFs): Promise<DetectResult>;   // confidence this adapter fits (injected read-only repo view)
  capabilities(): AdapterCapabilities;   // which phases it supports
  build(ctx: CommandContext): Promise<CommandResult>;
  test(ctx: CommandContext): Promise<CommandResult>;
  lint(ctx: CommandContext): Promise<CommandResult>;
  run(ctx: CommandContext):  Promise<CommandResult>;   // start the app (smoke target)
  deploy(ctx: CommandContext): Promise<CommandResult>;
  describe(): AdapterDescription;        // human/brief-readable command summary
}

interface DetectResult { matched: boolean; confidence: number; reason: string; }
interface AdapterCapabilities {
  build: boolean; test: boolean; lint: boolean; run: boolean; deploy: boolean;
}
interface AdapterDescription {
  // the literal commands, surfaced in the composed brief (M03 0012) so the work
  // cell runs the same steps the adopter's CI runs:
  commands: Partial<Record<'build'|'test'|'lint'|'run'|'deploy', string>>;
}
```

**Detect / selection (0025 plugs in here):** the auto-detector calls `detect()` on
each registered adapter, takes the highest `confidence` over a threshold, and falls
back to `generic` when none match. Explicit `looper.yml` config
(`adapter: node` or per-phase command overrides) always wins over detection — see
0025/0026. The registry is a small fixed array in `@looper/adapters`
(`[node, python, generic]`), not a plugin loader ([codebase](../../docs/codebase.md)
"No plugin-loader/marketplace framework").

**Generic adapter (0026) plugs in here** as the universal `capabilities`-all-true
fallback: it reads commands straight from config
(`adapter.commands.{build,test,lint,run,deploy}`) and shells them via the injected
`CommandRunner`, returning the same `CommandResult`. Because `generic` exists, every
phase is satisfiable for any repo and `capabilities()` is the runner's guide for
which phases to skip (`skipped: true`) when an adapter omits one.

**Unsupported / missing phase:** when an adapter cannot perform a phase it returns
`{ ok: true, skipped: true, output: 'no <phase> command', durationMs: 0 }` rather
than throwing — the controller treats a skipped phase as a non-blocking pass and
records it. A phase that *runs* and fails returns `ok: false` with captured output.

**IO boundary:** `@looper/core` declares the interface and types only (no
child-process import); `@looper/runtime` supplies the concrete `CommandRunner`
(exec with cwd/env/timeout/abort) when it injects an adapter. This keeps `core`
IO-free per the one-way dependency rule.

## Out Of Scope

- The auto-detect heuristics themselves (0025) and the generic adapter
  implementation (0026).
- Bundled node/python command tables (0027) and the authoring guide + conformance
  test kit (0028).
- Deploy smoke/canary/rollback orchestration (M11) — this task only defines the
  `deploy`/`run` *contract* the deploy loop calls.

## Acceptance Criteria

- [x] `ProjectAdapter` exists as real TS in `@looper/core`, importable by
      `@looper/adapters` and `@looper/runtime`.
- [x] Every lifecycle method (`build/test/lint/run/deploy`) returns a normalized
      `CommandResult` (`{ ok, output, durationMs, ... }`); none throw on a
      missing/unsupported phase (returns `skipped: true` instead).
- [x] `detect()` returns a `DetectResult` with a comparable `confidence`, enabling
      selection (0025).
- [x] `capabilities()` and `describe()` expose which phases exist + their literal
      commands (consumable by the brief composer, M03 0012).
- [x] Adapters never spawn processes directly — they exec via the injected
      `CommandRunner`; `@looper/core` imports no IO module.
- [x] A trivial in-package fake adapter conforms to the interface and drives all six
      methods (proof the contract is implementable).

## Implementation Checklist

- [x] Define `CommandResult`, `CommandContext`, `CommandRunner`, `RepoFs`, `DetectResult`,
      `AdapterCapabilities`, `AdapterDescription` in `@looper/core/src/ports/`.
- [x] Define the `ProjectAdapter` interface alongside them; export via the `core`
      barrel.
- [x] Add the adapter registry shape (fixed array) skeleton in `@looper/adapters`.
- [x] Specify the skipped/failed/passed result semantics in code comments + this
      file's Decisions.
- [x] Add a minimal fake adapter under `@looper/testing` for the conformance kit
      (0028) to build on.
- [x] Confirm consumers (0025/0026/0027 stubs, 0012 brief composer) type-check
      against the interface.

## Test Plan

Tests run via the repo's vitest runner; this is a pure-interface + types task so the
suite is type-checking plus a fake adapter exercised with the M18 fakes (no real
quota, no child processes):

```bash
# type-check: adapters/runtime compile against @looper/core's ProjectAdapter
# unit: fake adapter returns normalized CommandResult for each phase;
#       missing phase -> skipped:true (not a throw); failed command -> ok:false
# inject a fake CommandRunner (M18) so no real process spawns
```

## Verification Log

- 2026-06-09: adapters suite green (149 tests repo-wide): all three adapters
  pass the seven-clause conformance kit; detection ranking/floor/override/
  disable behaviors proven; command-precedence and shell-vs-exec semantics
  proven.

## Decisions

- Final shapes exactly as drafted in the spec, in
  `core/ports/project-adapter.ts`: `ProjectAdapter` (name, detect,
  capabilities, five phase methods, describe), `CommandResult`
  ({ok,output,durationMs,exitCode?,skipped?}), `CommandContext` (workdir, env,
  injected CommandRunner, AbortSignal), `RepoFs` (exists/read/list, async).
- DetectResult carries `evidence: string[]` + optional `toolchain` (the 0025
  shape) instead of a single `reason` string — strictly richer, one shape for
  both tasks (recorded reconciliation of the two specs' RepoFs/DetectResult
  variants: the async port version governs).
- `skippedResult(phase)` ships in core as the uniform no-op answer.
- The CommandRunner injection point keeps core IO-free and adapters spawn-free
  (conformance clause 5 enforces it).

## Risks / Rollback

Over-fitting the interface to one stack (e.g. node) would make the generic
escape hatch (0026) or python adapter (0027) awkward — validate the contract against
generic + node + python shapes before freezing it, the same discipline 0019 applies
to backends. Getting the `CommandResult`/`CommandContext` shape wrong ripples to
every adapter and to the brief composer (0012); pin it before 0025–0028 start.
Rollback is low-cost while only the interface + a fake exist (no behavior shipped).

## Final Summary

The ProjectAdapter contract is frozen in core exactly per spec: six
lifecycle methods over an injected CommandRunner, honest capabilities,
normalized results, a read-only RepoFs detect, and describe() feeding briefs/
CI. Exercised by three implementations + the conformance kit.
