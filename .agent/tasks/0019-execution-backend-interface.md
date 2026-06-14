# 0019 Execution Backend Interface

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Define the one contract every execution backend satisfies — `dispatch(brief) →
ingest(events) → result` plus capability metadata — so loops are written once and
run on Claude, Codex, or the self-hosted backend unchanged.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md).
The controller (M03 · 0012) calls this interface; the Claude (0020), Codex (0021),
and self-hosted (0074) backends implement it; the dispatch/ingest correlation
(0073) is shared. See [architecture](../../docs/architecture.md) "Execution model."

## Scope

- The backend interface methods + types.
- Capability metadata so the controller adapts to each backend's limits.
- The async dispatch→ingest split (dispatch returns a handle; results arrive
  later via GitHub events).

### Technical detail

```
Backend:
  capabilities() -> {
    trigger_modes: [api_fire | github_event | mention | self_hosted_dispatch],   # how it's invoked
    runs_sandbox: bool,            # provider hosts the test sandbox?
    secret_phase: full | setup-only | none,   # when secrets are available
    network: on | setup-only | off,
    opens_pr: bool, supports_review: bool
  }
  dispatch(brief, context) -> DispatchHandle    # async; returns immediately
  ingest(github_event) -> IngestResult | null   # called by the runner on events
```

- **brief**: composed prompt + acceptance criteria + repo/issue context + the
  expected output contract ("open a PR labeled in-review referencing #N").
- **DispatchHandle**: carries the **correlation id** (run_id) the ingest step
  matches against (0073), plus a provider reference (routine/session/PR-comment id)
  for the CLI's session link.
- **dispatch is async**: it kicks off provider cloud work and returns; the runner
  ends. A later event invokes `ingest`, which matches the PR to the run and returns
  the result (or `null` if the event isn't ours).
- **capabilities drive behavior**: e.g. `secret_phase: setup-only` (Codex) tells
  the runner not to rely on the sandbox for secret-dependent tests and to lean on
  the adopter's CI; `trigger_modes` selects the dispatch mechanism.

## Out Of Scope

- Provider-specific implementations (0020/0021/0074); correlation mechanics (0073).

## Acceptance Criteria

- [x] A documented interface with `capabilities`, `dispatch`, `ingest` and their
      types.
- [x] `dispatch` is async (returns a handle without blocking on provider work).
- [x] Capability metadata is rich enough for the runner to adapt (trigger mode,
      secret phase, sandbox, review support).
- [x] At least one backend (0020) conforms; the runner is provider-agnostic.

## Implementation Checklist

- [x] Define the interface + DispatchHandle/IngestResult types.
- [x] Define the capability metadata schema.
- [x] Define the brief/output-contract shape passed to `dispatch`.
- [x] Provide a conformance harness backends are tested against.

## Test Plan

```bash
# replace with the chosen stack's runner
# a fake backend implementing the interface drives a transition end-to-end
```

## Verification Log

- 2026-06-09: three real backends (claude/codex/self-hosted) + the scripted
  fake all conform; the provider-agnostic runner drives any of them through
  dispatch→ingest in the runner/sweep suites. 119 tests green.

## Decisions

- Signatures (in `@loopdog/core/ports/backend.ts`): `capabilities():
  BackendCapabilities`, `dispatch(brief: WorkBrief): Promise<DispatchHandle>`
  (async — returns immediately with the dispatch-time correlation signal),
  `ingest(handle): Promise<IngestResult>` (non-blocking poll; `pending` until
  found; runner/sweep own re-invocation; M19 owns timeouts).
- Capability fields per the spec: triggerModes (api_fire|mention|github_event|
  self_hosted_dispatch), runsSandbox, secretPhase (full|setup-only|none),
  network (on|setup-only|off), opensPr, supportsReview, zdrCompatible,
  throughput.tasksPerHour (null = uncapped), quotaNote.
- Brief shape = `WorkBrief` (composed text incl. the non-overridable output
  contract, briefRef version handle, expectedBranch/Trailer, expectation).
- DispatchHandle carries the run id + the authoritative dispatch-time signal
  (claude-session | codex-mention | workflow-run | local-process) per the 0093
  dual-signal decision.
- Conformance harness = the shared backend test suite + the FakeBackend in
  `@loopdog/testing` (the M06-0028-style kit for backends).

## Risks / Rollback

Over-fitting the interface to Claude would make Codex (mention-only, no API) or
self-hosted awkward; validate the interface against all three backends' shapes
before freezing it.

## Final Summary

The one backend contract lives in core (0094-landed, now consumer-proven):
capabilities/dispatch/ingest with rich capability metadata, an async
dispatch→handle→later-ingest split, and the dual-signal correlation types.
Three real conforming implementations + the scripted fake; the runner is
provider-agnostic (proven by swapping backends in tests).
