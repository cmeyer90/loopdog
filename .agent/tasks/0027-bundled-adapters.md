# 0027 Bundled Adapters

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Ship the first-party `node` and `python` project adapters: concrete
implementations of the `ProjectAdapter` interface (0024) that describe how to
`build / test / lint / run / deploy` a Node or Python repo, so looper operates
those stacks out of the box without bespoke config and gives Milestone 06 its
"≥2 bundled adapters" Definition-of-Done.

## Background

Part of [Milestone 06](../milestones/milestone-06-project-adapter-system.md) —
the project-adapter plugin system, one of looper's three genericity surfaces
([architecture](../../docs/architecture.md) "Generic-ness, in three plugin
systems" → project adapters). The bundled adapters are the proof the interface is
real: they exercise the contract (0024), are the auto-detect targets (0025), and
backstop the generic command adapter (0026) for recognized stacks. They land in
`@looper/adapters` (`packages/adapters/src/{node,python}/`, see
[codebase](../../docs/codebase.md) — `adapters` package). Each adapter's commands
become the verification the controller runs in the adopter's CI and the
build/test instructions the brief hands the work cell.

## Scope

- A `node` adapter and a `python` adapter implementing the full `ProjectAdapter`
  contract (0024), declaring per-capability commands and a `detect()` signal.
- Sensible per-stack defaults with config override (every command overridable via
  `looper.yml`'s `adapter:` block).
- Each adapter passes the conformance kit (0028) and registers itself for
  auto-detection (0025).

### Technical detail

Both implement the `ProjectAdapter` port declared in `@looper/core`
(`packages/core/src/ports/`). Shape (final names follow 0024):

```ts
interface ProjectAdapter {
  readonly name: string;                                  // identity field is "name" (NOT "id")
  detect(repo: RepoFs): Promise<DetectResult>;            // injected read-only repo view
  capabilities(): AdapterCapabilities;                    // OBJECT { build,test,lint,run,deploy: boolean }
  build(ctx: CommandContext): Promise<CommandResult>;     // same for test/lint/run/deploy
  describe(): AdapterDescription;
}
```

Each phase method (`build`/`test`/`lint`/`run`/`deploy`) executes its step and
returns a `CommandResult = { ok, output, durationMs, exitCode?, skipped? }`. A
capability the repo lacks is reported `false` in `capabilities()` and its method
returns `{ skipped: true }`. Adapters are filesystem-read-only at `detect()` (via
the injected `RepoFs` view); no network, no provider calls.

**`node` adapter** (`packages/adapters/src/node/`):
- `detect`: `package.json` present → matched. Confidence boosted by a lockfile
  (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb`) which also
  picks the package manager (npm/pnpm/yarn/bun); evidence lists the files seen.
- Commands prefer `package.json` `scripts` when present, else a manager default:
  - `build` → `<pm> run build` (omit if no `build` script).
  - `test` → `<pm> test` (or `run test`).
  - `lint` → `<pm> run lint` (omit if absent).
  - `run` → `scripts.start` ? `<pm> start` : `node <main-from-package.json>`.
  - `deploy` → none by default (deploy is project-specific; left to config/0026).
- Install step (`<pm> ci`/`install`) surfaced via `AdapterCtx` so CI/brief can
  prepare deps before build/test.

**`python` adapter** (`packages/adapters/src/python/`):
- `detect`: `pyproject.toml` (primary), else `requirements.txt` / `setup.py` /
  `Pipfile`. Confidence highest for `pyproject.toml`; evidence lists files. Detect
  tool family from `pyproject.toml` (`[tool.poetry]`/`[tool.hatch]`/PEP 621 +
  `uv.lock`) to choose the runner (`uv`/`poetry`/`pip`).
- Commands:
  - `build` → `<runner> build` (pyproject) or none.
  - `test` → `pytest` (or `<runner> run pytest`); fall back to
    `python -m unittest` if no pytest config detected.
  - `lint` → `ruff check .` if ruff configured, else `flake8`, else omit.
  - `run` → project script/entrypoint from `[project.scripts]` else
    `python -m <package>`/none.
  - `deploy` → none by default.

**Config override** (in `@looper/config` schema, consumed here): the scalar
`adapter: <name>` (default `auto`) pins which adapter to use; a related override
block lets the adopter set the package manager/runner and any per-capability
command, e.g.

```yaml
adapter: node
adapterOptions:
  packageManager: pnpm
  commands:
    test: { argv: ["pnpm", "vitest", "run"] }
    deploy: { argv: ["./scripts/deploy.sh"] }
```

Resolution precedence: explicit `adapterOptions.commands.<cap>` > `package.json`/
`pyproject.toml`-derived > manager/runner default. Setting `adapter: <name>`
skips auto-detect entirely.

**Registration:** both register in the adapter registry the resolver (0025) reads;
ordering is detect-confidence-descending with `generic` (0026) as the floor.

**Edge cases:** monorepos / multiple lockfiles (lowest-friction: highest-confidence
signal wins, surface `evidence` so 0025/CLI can disambiguate); missing
build/lint script → that capability is reported `false` in `capabilities()` (and
its phase method returns `{ skipped: true }`) rather than erroring; a stack with
both `pyproject.toml` and
`requirements.txt` resolves to the higher-confidence pyproject path.

## Out Of Scope

- The `ProjectAdapter` interface definition itself (0024).
- The auto-detection resolver/selection algorithm (0025) — adapters only expose
  `detect()` signals; the resolver lives there.
- The generic command escape hatch (0026).
- The authoring guide + conformance test kit (0028) — these adapters *consume* the
  kit; they don't define it.
- Actually executing commands or running deploys (runtime/CI + M11 own execution).

## Acceptance Criteria

- [x] A `node` adapter exists implementing the full `ProjectAdapter` contract,
      detecting a Node repo and emitting correct build/test/lint/run commands per
      package manager (npm/pnpm/yarn/bun).
- [x] A `python` adapter exists implementing the full contract, detecting a Python
      repo and emitting correct commands per runner (uv/poetry/pip).
- [x] Capabilities a repo lacks (e.g. no `build` script) report unsupported
      rather than emitting a broken command.
- [x] Any per-capability command is overridable via the `looper.yml` `adapter:`
      block, with override taking precedence over derived/default.
- [x] Both adapters pass the conformance kit (0028) and register for
      auto-detection (0025).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Implement `packages/adapters/src/node/` against the 0024 interface
      (detect + capabilities + command resolution + package-manager detection).
- [x] Implement `packages/adapters/src/python/` likewise (runner detection).
- [x] Wire `package.json`/`pyproject.toml` script discovery + override precedence.
- [x] Register both in the adapter registry (0025) and export via
      `packages/adapters/src/index.ts`.
- [x] Add config schema support for the `adapter:` override block (with 0024/config).
- [x] Run the conformance kit (0028) against both; add stack-specific tests.

## Test Plan

Tests run via the repo's vitest runner; adapters are pure (filesystem-read +
command-descriptor output) so no real quota or M18 backend fakes are needed —
fixture repos under `test/fixtures/` provide the filesystem inputs.

```bash
# replace with the chosen stack's vitest invocation, e.g.
npm run -w @looper/adapters test
# fixtures: a Node repo (npm/pnpm/yarn variants) + a Python repo (uv/poetry/pip)
# assert detect() confidence + evidence, per-capability command argv, unsupported
# capabilities → null, and override precedence; run the 0028 conformance kit.
```

## Verification Log

- 2026-06-09: adapters suite green (149 tests repo-wide): all three adapters
  pass the seven-clause conformance kit; detection ranking/floor/override/
  disable behaviors proven; command-precedence and shell-vs-exec semantics
  proven.

## Decisions

- Node: package.json marker (0.7) boosted to 0.9 by a lockfile which also
  picks the pm (pnpm/yarn/bun/npm); commands prefer package.json scripts;
  run falls back to `node <main>`; deploy deliberately absent (config/0026
  territory); install surfaced via describe().install.
- Python: pyproject (0.9) else requirements/setup.py/Pipfile (0.6); runner
  from uv.lock / [tool.poetry] / pip default; pytest preferred with a
  unittest fallback; ruff when configured; install per runner.
- Both: precedence override > manifest-derived > toolchain default; missing
  scripts report capability false + skip (never error).

## Risks / Rollback

Wrong package-manager/runner inference emits commands that fail in the adopter's
CI — mitigated by the override block (always escapable) and the generic adapter
(0026) as a fallback. Adapters are pure data producers, so reverting one is
isolated to its `src/<stack>/` folder and registry entry.

## Final Summary

Node and Python adapters implement the full contract with honest detection
evidence, manifest-derived commands, per-stack toolchain resolution, and
config overrides — both pass the conformance kit alongside generic.
