# Milestone 09: Implementation Loop

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "The loops"
> (implementation). Uses the provider (M05) and project adapter (M06).

## Objective

Take a `ready-for-agent` issue through `in-progress` → `in-review` generically:
claim it, post the plan contract, implement against the plan using the project
adapter for build/test, respect blast-radius limits, and open a PR — keeping the
durable plan accurate throughout.

## Guiding Decisions

- The controller owns claim/budget/retry; it dispatches the code-change work cell
  to the configured execution backend (M05) and ingests the resulting PR.
- On the primary path the provider's cloud agent clones the repo and runs
  build/test in the provider sandbox; looper makes no direct model API call.
- Refuses to start unless DoR is satisfied (M03 gate).
- Enforces blast-radius limits (max files / max diff); scope-exceeding work halts
  and escalates instead of ballooning.
- Build/test are described via the project adapter (stack-agnostic) and
  re-verified by the adopter's CI on the PR — the trustworthy gate, independent of
  where the work cell ran.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0037 | planned | task/0037-implementation-work-cell | Implementation Work Cell | Implements the task and updates the plan as it works. |
| 0038 | planned | task/0038-blast-radius-and-scope-guards | Blast-Radius & Scope Guards | Max-files/max-diff guard with escalate-on-exceed. |
| 0039 | planned | task/0039-branch-pr-automation | Branch/PR Automation | Branch creation, PR open, plan-contract posting. |
| 0040 | planned | task/0040-adapter-driven-build-test | Adapter-Driven Build & Test | Build/test described via the adapter; run in the provider sandbox and re-verified by the adopter's CI on the PR. |

## Definition Of Done

- A `ready-for-agent` issue is claimed atomically and moved to `in-progress`.
- The work cell implements the change, runs adapter build/test, and opens a PR
  labeled `in-review` with the plan contract posted.
- Scope-exceeding work halts and escalates.
- The plan reflects the actual work (checklist, verification log, decisions) at
  PR time.

## Verification Log

Add dated entries as tasks land.
