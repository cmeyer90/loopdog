# Guide: write a model provider (execution backend)

A **backend** is how Loopdog runs a unit of work: it dispatches a `WorkBrief` to a
provider and later ingests the result (a PR or a comment) by correlation. The
controller is provider-agnostic — add a backend and any loop can target it.

> Backends implement the `ExecutionBackend` port (`@loopdog/core`). Loopdog ships
> three: `claude` + `codex` (subscription-driven, no API key) and `self-hosted`
> (the **secondary, key-holding escape hatch** — the only path that uses a model
> API key). A new provider should follow the subscription model where it can.

## The contract

```ts
import type {
  ExecutionBackend,
  BackendCapabilities,
  WorkBrief,
  DispatchHandle,
  IngestResult,
} from '@loopdog/core';

export class MyBackend implements ExecutionBackend {
  readonly id = 'my-backend';

  capabilities(): BackendCapabilities {
    return {
      triggerModes: ['api_fire'], // how it's invoked
      runsSandbox: true,
      secretPhase: 'full', // 'full' | 'setup-only' | 'none'
      network: 'on',
      opensPr: true,
      supportsReview: true,
      zdrCompatible: false,
      throughput: { tasksPerHour: null }, // null = uncapped (the quota gate models real caps)
      quotaNote: 'describe the real provider cap',
    };
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    // Invoke the provider with brief.instructions, asking it to push to
    // brief.expectedBranch and put `brief.expectedTrailer` in the PR body.
    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt: new Date().toISOString(),
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: { kind: 'claude-session', sessionId: '<provider handle>' }, // the dispatch-time key
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    // Find the provider's PR and return it; the controller correlates by
    // branch name + the `loopdog-run:` trailer + issue ref (the dispatch-time
    // signal is authoritative). Return { status: 'pending' } until it appears.
    return { status: 'pending' };
  }
}
```

### Correlation (0073) is the load-bearing part

Loopdog splits **dispatch** and **ingest** so a cloud agent can run async. You do
not return the PR from `dispatch`; you return a `DispatchHandle` carrying the
three correlation signals (`expectedBranch`, `expectedTrailer`, the dispatch-time
`signal`). A later `ingest` finds the PR and Loopdog matches it. **Reuse the real
correlation matcher** — don't reinvent it. Idempotency matters: ingesting the
same handle twice must yield one effect (find the existing PR, don't open a new
one).

## Register it

Backends are a fixed array in `@loopdog/backends` (`createBackendRegistry`) — no
plugin system, no dynamic loading. Add your class there and reference it by `id`
in `backends.default` / a loop's `backend`.

## Verify with the conformance harness (offline, zero quota)

```ts
import { runBackendConformance, FakeGitHub } from '@loopdog/testing';

runBackendConformance({
  name: 'my-backend',
  makeBackend: (gh: FakeGitHub) => new MyBackend(/* over the fake gh */),
});
```

`runBackendConformance` drives dispatch→ingest on the in-memory fake GitHub and
asserts the contract: a well-formed capability shape, a handle carrying the three
signals, a correlated PR on ingest, and **idempotent re-ingest**. It spends zero
quota. Record-once/replay cassettes (`ReplayBackend`) let a component test run a
faithful recording in CI; a live smoke (tier 5) exercises the real provider.

## Publish

Open a PR adding the backend class + its registry entry + a conformance test.
Keep capabilities honest — the quota gate, the review-pairing policy, and the
work-cell secret phase all read them.
