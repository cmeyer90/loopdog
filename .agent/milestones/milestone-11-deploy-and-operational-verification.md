# Milestone 11: Deploy & Operational Verification

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) — verification
> ladder rung 4 and "rollback as a first-class loop." Deploy is project-specific,
> so it runs through the adapter (M06). Depends on Milestones 06 and 07.

## Objective

On merge, deploy the affected services via the project adapter, prove they are
operational with smoke/canary + health checks, and auto-roll-back on failure — so
"merged" reliably implies "deployed and healthy," for any project's deploy target.

## Guiding Decisions

- Deploy is adapter-driven; loopdog makes no assumptions about the target's
  infrastructure.
- Deploy secrets come from the bring-your-own backend (M07); no loopdog-baked
  cloud creds.
- Smoke/health assertions gate promotion; rollback is a first-class loop with its
  own trigger.
- The optional adversarial deploy gate (one model proposes, another writes smoke
  assertions) is available for high-risk targets.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0046 | verified | task/0046-adapter-driven-deploy | Adapter-Driven Deploy | Merge-triggered deploy through the project adapter. |
| 0047 | verified | task/0047-smoke-canary-health-gate | Smoke/Canary & Health Gate | Post-deploy assertions gating promotion + feeding merge DoD. |
| 0048 | verified | task/0048-auto-rollback-loop | Auto-Rollback Loop | Failure-triggered rollback with health re-verification. |
| 0049 | verified | task/0049-deploy-result-reporting | Deploy Result Reporting | Deploy outcome reported to the PR/issue and the plan. |

## Definition Of Done

- [x] Merging marks the work item deploying; the adapter's deploy command runs
  in the adopter's CI with their own secrets (loopdog-deploy template; no
  loopdog-baked creds).
- [x] A deploy is not successful until the deploy + deploy-smoke checks pass
  (check-gated promotion; e2e-proven green and red).
- [x] A failed smoke fails over to deploy-failed and the rollback loop
  promotes to rolled-back once the rollback check is green (e2e-proven).
- [x] Deploy outcomes report onto the item (labels/comments), the durable plan
  (plan-sync), and run records/job summaries.

## Verification Log
- 2026-06-09: all tasks verified offline: the loops e2e suite drives the real
  scaffolded templates on fakes through the full lifecycle (169 tests green
  repo-wide). Live provider behavior remains the M00 operator item.
