# Authoring a Project Adapter

> The guide for task 0028. An adapter teaches looper how to operate one stack:
> `detect / build / test / lint / run / deploy`. Adapters **describe what to
> run**; looper's runtime owns *how* (process execution) — your adapter never
> spawns anything itself.

## What an adapter is

The contract is `ProjectAdapter` in `@looper/core` (`ports/project-adapter.ts`):

```ts
interface ProjectAdapter {
  readonly name: string;                          // "node" | "python" | yours
  detect(repo: RepoFs): Promise<DetectResult>;    // pure, read-only, idempotent
  capabilities(): AdapterCapabilities;            // which phases you support
  build/test/lint/run/deploy(ctx: CommandContext): Promise<CommandResult>;
  describe(): AdapterDescription;                 // the literal commands
}
```

Rules the conformance kit enforces:

- `detect()` is **pure and idempotent** over the injected read-only `RepoFs` —
  no real filesystem, no network, no state. Return honest `confidence` (0..1)
  and human-readable `evidence`. Never claim a repo you don't recognize.
- **Capability honesty**: a phase you report `false` must return
  `{ ok: true, skipped: true, durationMs: 0 }` — never throw. A phase you
  report `true` must invoke the injected runner.
- **No direct spawning**: run commands only through `ctx.run` (the injected
  `CommandRunner`). This is what makes adapters testable offline and lets the
  runtime own timeouts/cancellation.
- **Normalized results**: every phase returns
  `{ ok, output, durationMs, exitCode? }` — a non-zero exit is `ok: false`
  with the captured output tail.
- `describe()` documents the literal command per supported phase — these
  strings go into composed briefs and the adopter's CI, so they must be real.

## Walkthrough

1. **Scaffold.** Create your package (or a module in a fork of
   `@looper/adapters`) exporting a class implementing `ProjectAdapter`.
2. **Implement `detect`.** Look for your stack's marker files via
   `repo.exists` / `repo.read` (e.g. `go.mod`), boost confidence for lockfiles
   that pin a sub-toolchain, and record everything you saw in `evidence`.
   Cache what you learned on the instance for `capabilities()`/`describe()`.
3. **Implement the phases.** Build the command per phase with the precedence
   `explicit config override > project-manifest-derived > toolchain default`,
   and execute via `ctx.run` (array argv preferred — no shell, no
   word-splitting).
4. **Run the conformance kit** (the same one looper's bundled adapters pass):

```ts
import { runAdapterConformance, repoFsFixture, ADAPTER_FIXTURES } from '@looper/testing';

describe('go adapter', () => {
  runAdapterConformance(() => new GoAdapter(), {
    fixtures: [
      { name: 'go-mod', repo: repoFsFixture({ 'go.mod': 'module x' }), expectMatch: true },
      { name: 'empty', repo: ADAPTER_FIXTURES.empty, expectMatch: false },
    ],
    expectCapabilities: { build: true, test: true },
  });
});
```

The kit registers seven named clauses: shape, detect contract, capability
honesty, result normalization, no direct spawning, describe coverage, and
detect idempotence. All seven must pass.

5. **Register.** There is deliberately **no plugin loader**: open a PR adding
   your adapter to the fixed registry in `@looper/adapters`
   (`createAdapterRegistry`), or keep it in your own fork — the registry is a
   plain array.

## How selection works (0025)

`detectStack` scores every registered adapter, sorts by confidence (ties break
on a fixed priority order, never file order), and `chooseAdapter` applies:
explicit `adapter:` config always wins → top match at/above the confidence
floor (default 0.5) → the generic command adapter. Detection never throws;
`generic` guarantees every repo is operable.

## Config surface

```yaml
# looper.yml
adapter: auto            # auto | node | python | generic | <yours>
adapter_options:
  package_manager: pnpm  # node hint
  runner: uv             # python hint
  commands:              # per-phase override, any adapter
    test: ['pnpm', 'vitest', 'run']
    deploy: './scripts/deploy.sh'
```
