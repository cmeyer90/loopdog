# Milestone 11: Deploy & Operational Verification

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — verification
> ladder rung 4 and "rollback as a first-class loop." Deploy is project-specific,
> so it runs through the adapter (M06). Depends on Milestones 06 and 07.

## Objective

On merge, deploy the affected services via the project adapter, prove they are
operational with smoke/canary + health checks, and auto-roll-back on failure — so
"merged" reliably implies "deployed and healthy," for any project's deploy target.

## Guiding Decisions

- Deploy is adapter-driven; looper makes no assumptions about the target's
  infrastructure.
- Deploy secrets come from the bring-your-own backend (M07); no looper-baked
  cloud creds.
- Smoke/health assertions gate promotion; rollback is a first-class loop with its
  own trigger.
- The optional adversarial deploy gate (one model proposes, another writes smoke
  assertions) is available for high-risk targets.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0046 | planned | task/0046-adapter-driven-deploy | Adapter-Driven Deploy | Merge-triggered deploy through the project adapter. |
| 0047 | planned | task/0047-smoke-canary-health-gate | Smoke/Canary & Health Gate | Post-deploy assertions gating promotion + feeding merge DoD. |
| 0048 | planned | task/0048-auto-rollback-loop | Auto-Rollback Loop | Failure-triggered rollback with health re-verification. |
| 0049 | planned | task/0049-deploy-result-reporting | Deploy Result Reporting | Deploy outcome reported to the PR/issue and the plan. |

## Definition Of Done

- Merging deploys exactly the affected target via the adapter, using
  bring-your-own deploy secrets.
- A deploy is not successful until smoke/canary + health checks pass.
- A failed check triggers automatic rollback and re-verification.
- Deploy outcome is reported onto the PR/issue and the durable plan.

## Verification Log

Add dated entries as tasks land.
