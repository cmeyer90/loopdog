# 0019 Execution Backend Interface

Status: planned  
Branch: task/0019-execution-backend-interface

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

- [ ] A documented interface with `capabilities`, `dispatch`, `ingest` and their
      types.
- [ ] `dispatch` is async (returns a handle without blocking on provider work).
- [ ] Capability metadata is rich enough for the runner to adapt (trigger mode,
      secret phase, sandbox, review support).
- [ ] At least one backend (0020) conforms; the runner is provider-agnostic.

## Implementation Checklist

- [ ] Define the interface + DispatchHandle/IngestResult types.
- [ ] Define the capability metadata schema.
- [ ] Define the brief/output-contract shape passed to `dispatch`.
- [ ] Provide a conformance harness backends are tested against.

## Test Plan

```bash
# replace with the chosen stack's runner
# a fake backend implementing the interface drives a transition end-to-end
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the exact method signatures, the capability fields, and the brief/output
contract shape.

## Risks / Rollback

Over-fitting the interface to Claude would make Codex (mention-only, no API) or
self-hosted awkward; validate the interface against all three backends' shapes
before freezing it.

## Final Summary

Fill this in before marking verified.
