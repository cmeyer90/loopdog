# Milestone 09: Implementation Loop

Status: verified

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
| 0037 | verified | task/0037-implementation-work-cell | Implementation Work Cell | Implements the task and updates the plan as it works. |
| 0038 | verified | task/0038-blast-radius-and-scope-guards | Blast-Radius & Scope Guards | Max-files/max-diff guard with escalate-on-exceed. |
| 0039 | verified | task/0039-branch-pr-automation | Branch/PR Automation | Branch creation, PR open, plan-contract posting. |
| 0040 | verified | task/0040-adapter-driven-build-test | Adapter-Driven Build & Test | Build/test described via the adapter; run in the provider sandbox and re-verified by the adopter's CI on the PR. |

## Definition Of Done

- [x] A `ready-for-agent` issue is claimed atomically and moved to
  `in-progress` (nonce'd CAS + DoR gate; e2e-proven).
- [x] The work cell implements against the brief (adapter commands included),
  and the resulting PR ingests to `in-review` with labels on both items.
- [x] Scope-exceeding work halts and escalates (blast-radius e2e scenario:
  needs-human + explanatory comment, never advanced).
- [x] The plan reflects the work through plan-sync (status mirror + run-keyed
  verification log) at every transition.

## Verification Log
- 2026-06-09: all tasks verified offline: the loops e2e suite drives the real
  scaffolded templates on fakes through the full lifecycle (169 tests green
  repo-wide). Live provider behavior remains the M00 operator item.
