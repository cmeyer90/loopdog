# Guide: write a project adapter

A **project adapter** teaches Loopdog how to build/test/lint/run/deploy a project
type. The built-ins are `node`, `python`, and a config-driven `generic`; `auto`
detects which fits. Write one when your stack needs commands the generic adapter
can't express from config.

> Adapters implement the `ProjectAdapter` port (`@loopdog/core`). They are **pure
> over an injected runner** — an adapter never spawns a process directly; it
> returns the commands, and the runtime executes them. (This file is the
> canonical adapter how-to; the older `docs/adapters.md` points here.)

## The contract

```ts
import type {
  ProjectAdapter,
  AdapterCapabilities,
  AdapterDescription,
  CommandContext,
  CommandResult,
  DetectResult,
  RepoFs,
} from '@loopdog/core';

export class MyAdapter implements ProjectAdapter {
  readonly name = 'my-stack';

  async detect(repo: RepoFs): Promise<DetectResult> {
    const has = await repo.exists('my-stack.toml');
    return {
      matched: has,
      confidence: has ? 0.9 : 0, // 0..1 — `auto` picks the highest above the floor
      evidence: has ? ['my-stack.toml present'] : [],
    };
  }

  capabilities(): AdapterCapabilities {
    return { build: true, test: true, lint: true, run: true, deploy: false };
  }

  describe(): AdapterDescription {
    return { install: 'my install', commands: { build: 'my build', test: 'my test' } };
  }

  // Each phase runs via the INJECTED runner (ctx.run) — never spawn directly.
  async build(ctx: CommandContext): Promise<CommandResult> {
    return toResult(await ctx.run(['my', 'build'], { cwd: ctx.workdir }));
  }
  async test(ctx: CommandContext): Promise<CommandResult> {
    return toResult(await ctx.run(['my', 'test'], { cwd: ctx.workdir }));
  }
  async lint(ctx: CommandContext): Promise<CommandResult> {
    return { ok: true, output: '', durationMs: 0, skipped: true }; // no-op phase
  }
  async run(ctx: CommandContext): Promise<CommandResult> { /* the smoke target */ }
  async deploy(ctx: CommandContext): Promise<CommandResult> { /* … */ }
}
```

Return a normalized `CommandResult` (`ok`/`output`/`durationMs`, `skipped: true`
for phases you don't support — a skip is a non-blocking pass). `detect` is a pure
read over `RepoFs`; the confidence drives `auto` selection (ties + a floor are
handled by `chooseAdapter`).

## Register it

Adapters are a fixed list in `@loopdog/adapters` (`createAdapterRegistry`). Add
your class there; adopters select it with `adapter: my-stack` (root or per loop),
or leave `adapter: auto` to let `detect` win.

## Verify with the conformance harness (offline)

```ts
import { runAdapterConformance, fakeCommandRunner, repoFsFixture } from '@loopdog/testing';

runAdapterConformance(() => new MyAdapter(), {
  fixtures: [
    { name: 'matches', repo: repoFsFixture({ 'my-stack.toml': '' }), expectMatch: true },
    { name: 'empty', repo: repoFsFixture({}), expectMatch: false },
  ],
  runner: fakeCommandRunner({ /* scripted exits per argv */ }),
});
```

`runAdapterConformance` is the 7-clause kit: detect confidence, capability/
describe agreement, each phase's result shape, skip semantics, and runner
injection (the adapter must never spawn directly). It runs fully offline.

## Publish

Open a PR adding the adapter class + its registry entry + a conformance test.
Keep `describe()` and `capabilities()` in agreement — composed work-cell briefs
and CI both read the commands from there.
