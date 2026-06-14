# Milestones

This file lists active roadmap milestones only. Completed milestones move to
`archive/milestones/` and are indexed in `archive/milestones.md`. See `README.md`
for how the planning system works and `PLANS.md` for the protocol.

North-star architecture for the V1 roadmap:
[Loopdog Architecture](../docs/architecture.md).

## Active Milestone Files

| Milestone | Layer | Status | File |
|---:|---|---|---|
| 00 | Validation | blocked | [Pre-Build Validation Spikes](milestones/milestone-00-pre-build-validation-spikes.md) |
| 01 | Foundation | implemented | [Project Foundation & Open-Source Scaffolding](milestones/milestone-01-project-foundation-and-oss-scaffolding.md) |
| 02 | Platform | implemented | [Attachment & Configuration Model](milestones/milestone-02-attachment-and-configuration-model.md) |
| 03 | Platform | verified | [GitHub State-Machine Core](milestones/milestone-03-github-state-machine-core.md) |
| 04 | Platform | verified | [Durable Planning Store](milestones/milestone-04-durable-planning-store.md) |
| 05 | Platform | verified | [Provider & Execution Backend Abstraction (Claude + Codex subscriptions)](milestones/milestone-05-model-provider-abstraction.md) |
| 06 | Platform | verified | [Project Adapter System](milestones/milestone-06-project-adapter-system.md) |
| 07 | Platform | verified | [Secrets & Identity (two-plane, subscription-native)](milestones/milestone-07-secrets-and-identity.md) |
| 08 | Loops | verified | [Grooming & Clarification Loop](milestones/milestone-08-grooming-and-clarification-loop.md) |
| 09 | Loops | verified | [Implementation Loop](milestones/milestone-09-implementation-loop.md) |
| 10 | Loops | verified | [Review, Verification Ladder & Merge Loop](milestones/milestone-10-review-verification-ladder-and-merge-loop.md) |
| 11 | Loops | verified | [Deploy & Operational Verification](milestones/milestone-11-deploy-and-operational-verification.md) |
| 12 | Cross-cutting | verified | [Observability, Cost & Safety](milestones/milestone-12-observability-cost-and-safety.md) |
| 13 | Cross-cutting | verified | [Multi-Model Orchestration](milestones/milestone-13-multi-model-orchestration.md) |
| 14 | Release | verified | [Documentation, Examples & Trust](milestones/milestone-14-documentation-examples-and-trust.md) |
| 15 | Release | implemented | [V1 Hardening & Release](milestones/milestone-15-v1-hardening-and-release.md) |
| 16 | Operator | verified | [Loop Control & Observability CLI](milestones/milestone-16-loop-control-and-observability-cli.md) |
| 17 | Hardening | verified | [Authorization & Trigger Control](milestones/milestone-17-authorization-and-trigger-control.md) |
| 18 | Hardening | verified | [Test & Simulation Harness](milestones/milestone-18-test-and-simulation-harness.md) |
| 19 | Hardening | verified | [Resilience & Failure Policy](milestones/milestone-19-resilience-and-failure-policy.md) |

Dependency order: **00 (validation spikes) gates everything** → 01 → 02 →
{03, 05, 06, 07} → 04 → 08 → 09 → 10 → 11; 12, 13, 16,
17, and 19 layer across the loops (17 and 19 are pre-flight gates in the runner);
18 (the test harness) is built alongside from the start; 14 and 15 finalize. Build
loops one at a time starting with grooming, and keep merge human-gated until the
verification ladder is proven on a real repo.

## Active Task-To-Milestone Map

Every task that has a file is registered in [`plan-index.md`](plan-index.md) and
mapped to its parent milestone below. Each milestone's full subtask breakdown and
primary deliverables live in that milestone file's **Planned Tasks** table.

| ID | Milestone | Status | Branch | Title |
|---:|---|---|---|---|
| 0092 | Milestone 00: Pre-Build Validation Spikes | verified | task/0092-tos-and-subscription-automation-spike | ToS & Subscription-Automation Validation |
| 0093 | Milestone 00: Pre-Build Validation Spikes | blocked | task/0093-dispatch-and-correlation-spike | Dispatch & Correlation Spike |
| 0001 | Milestone 01: Project Foundation & Open-Source Scaffolding | verified | task/0001-stack-and-repo-layout | Stack & Repo Layout |
| 0002 | Milestone 01: Project Foundation & Open-Source Scaffolding | verified | task/0002-license-and-community-files | License & Community Files |
| 0003 | Milestone 01: Project Foundation & Open-Source Scaffolding | verified | task/0003-own-ci-pipeline | Loopdog's Own CI |
| 0004 | Milestone 01: Project Foundation & Open-Source Scaffolding | implemented | task/0004-branch-protection-and-codeowners | Branch Protection & CODEOWNERS |
| 0005 | Milestone 01: Project Foundation & Open-Source Scaffolding | verified | task/0005-release-and-versioning | Release & Versioning |
| 0006 | Milestone 02: Attachment & Configuration Model | verified | task/0006-config-schema-and-validation | Config Schema & Validation |
| 0007 | Milestone 02: Attachment & Configuration Model | verified | task/0007-init-cli-and-scaffolding | `loopdog init` CLI & Scaffolding |
| 0008 | Milestone 02: Attachment & Configuration Model | verified | task/0008-event-driven-triggers | Event-Driven Triggers |
| 0076 | Milestone 02: Attachment & Configuration Model | verified | task/0076-cron-reconcile-sweep | Cron Reconcile Sweep |
| 0009 | Milestone 02: Attachment & Configuration Model | verified | task/0009-dry-run-and-safe-defaults | Dry-Run & Safe Defaults |
| 0077 | Milestone 02: Attachment & Configuration Model | implemented | task/0077-cli-github-connector-and-login | CLI GitHub Connector & `loopdog login` |
| 0010 | Milestone 02: Attachment & Configuration Model | implemented | task/0010-subscription-onboarding-and-backend-select | Subscription Onboarding & Backend Select |
| 0094 | Milestone 03: GitHub State-Machine Core | verified | task/0094-core-port-interfaces-and-run-record-store | Core Port Interfaces & Run-Record Store |
| 0011 | Milestone 03: GitHub State-Machine Core | verified | task/0011-label-state-machine-spec | Label State Machine Spec |
| 0012 | Milestone 03: GitHub State-Machine Core | verified | task/0012-transition-runner | Stateless Transition Runner |
| 0013 | Milestone 03: GitHub State-Machine Core | verified | task/0013-atomic-claiming-and-serialization | Atomic Claiming & Serialization |
| 0014 | Milestone 03: GitHub State-Machine Core | verified | task/0014-dor-dod-contract-gates | DoR / DoD Contract Gates |
| 0015 | Milestone 04: Durable Planning Store | verified | task/0015-portable-plan-format | Portable Plan Format |
| 0016 | Milestone 04: Durable Planning Store | verified | task/0016-issue-to-plan-binding | Issue ↔ Plan Binding |
| 0017 | Milestone 04: Durable Planning Store | verified | task/0017-plan-lifecycle-automation | Plan Lifecycle Automation |
| 0018 | Milestone 04: Durable Planning Store | verified | task/0018-plan-index-maintenance | Plan Index Maintenance |
| 0019 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0019-execution-backend-interface | Execution Backend Interface |
| 0020 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0020-claude-subscription-backend | Claude Subscription Backend |
| 0021 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0021-codex-subscription-backend | Codex Subscription Backend |
| 0073 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0073-dispatch-and-result-ingestion | Dispatch & Result Ingestion (correlation) |
| 0074 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0074-self-hosted-api-backend | Self-Hosted / API Backend (secondary) |
| 0022 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0022-prompt-and-policy-artifacts | Prompt & Policy Artifacts |
| 0023 | Milestone 05: Provider & Execution Backend Abstraction (Claude + Codex subscriptions) | verified | task/0023-backend-selection-and-subscription-auth | Backend Selection & Subscription Auth |
| 0024 | Milestone 06: Project Adapter System | verified | task/0024-adapter-interface | Adapter Interface |
| 0025 | Milestone 06: Project Adapter System | verified | task/0025-stack-autodetection | Stack Auto-Detection |
| 0026 | Milestone 06: Project Adapter System | verified | task/0026-generic-command-adapter | Generic Command Adapter |
| 0027 | Milestone 06: Project Adapter System | verified | task/0027-bundled-adapters | Bundled Adapters |
| 0028 | Milestone 06: Project Adapter System | verified | task/0028-adapter-authoring-guide-and-testkit | Adapter Authoring Guide & Test Kit |
| 0029 | Milestone 07: Secrets & Identity (two-plane, subscription-native) | verified | task/0029-provider-auth-and-scoped-identity | Repo Identity & Provider Auth |
| 0030 | Milestone 07: Secrets & Identity (two-plane, subscription-native) | verified | task/0030-provider-cloud-env-and-secrets | Provider Cloud Env & Secret Config |
| 0031 | Milestone 07: Secrets & Identity (two-plane, subscription-native) | verified | task/0031-self-hosted-secret-injection-and-leak-guards | Self-Hosted Secret Injection & Leak Guards |
| 0032 | Milestone 07: Secrets & Identity (two-plane, subscription-native) | verified | task/0032-secret-trust-boundary-doc | Secret Trust-Boundary & Constraints Doc |
| 0033 | Milestone 08: Grooming & Clarification Loop | verified | task/0033-grooming-work-cell | Grooming Work Cell |
| 0034 | Milestone 08: Grooming & Clarification Loop | verified | task/0034-event-driven-clarification | Event-Driven Clarification |
| 0035 | Milestone 08: Grooming & Clarification Loop | verified | task/0035-assumption-vs-block-policy | Assumption-vs-Block Policy |
| 0036 | Milestone 08: Grooming & Clarification Loop | verified | task/0036-grooming-loop-runtime | Grooming Loop Runtime |
| 0037 | Milestone 09: Implementation Loop | verified | task/0037-implementation-work-cell | Implementation Work Cell |
| 0038 | Milestone 09: Implementation Loop | verified | task/0038-blast-radius-and-scope-guards | Blast-Radius & Scope Guards |
| 0039 | Milestone 09: Implementation Loop | verified | task/0039-branch-pr-automation | Branch/PR Automation |
| 0040 | Milestone 09: Implementation Loop | verified | task/0040-adapter-driven-build-test | Adapter-Driven Build & Test |
| 0041 | Milestone 10: Review, Verification Ladder & Merge Loop | verified | task/0041-verification-ladder-wiring | Verification Ladder Wiring |
| 0042 | Milestone 10: Review, Verification Ladder & Merge Loop | verified | task/0042-cross-model-review-cell | Cross-Model Review Cell |
| 0043 | Milestone 10: Review, Verification Ladder & Merge Loop | verified | task/0043-intent-diff-against-criteria | Intent-Diff Against Criteria |
| 0044 | Milestone 10: Review, Verification Ladder & Merge Loop | verified | task/0044-fix-suggestions-subloop | Fix-Suggestions Sub-Loop |
| 0045 | Milestone 10: Review, Verification Ladder & Merge Loop | verified | task/0045-graduated-auto-merge-policy | Graduated Auto-Merge Policy |
| 0046 | Milestone 11: Deploy & Operational Verification | verified | task/0046-adapter-driven-deploy | Adapter-Driven Deploy |
| 0047 | Milestone 11: Deploy & Operational Verification | verified | task/0047-smoke-canary-health-gate | Smoke/Canary & Health Gate |
| 0048 | Milestone 11: Deploy & Operational Verification | verified | task/0048-auto-rollback-loop | Auto-Rollback Loop |
| 0049 | Milestone 11: Deploy & Operational Verification | verified | task/0049-deploy-result-reporting | Deploy Result Reporting |
| 0050 | Milestone 12: Observability, Cost & Safety | verified | task/0050-budgets-and-kill-switch | Budgets & Kill Switch |
| 0075 | Milestone 12: Observability, Cost & Safety | verified | task/0075-subscription-quota-management | Subscription Quota & Rate-Limit Management |
| 0051 | Milestone 12: Observability, Cost & Safety | verified | task/0051-stuck-detection-and-escalation | Stuck Detection & Escalation |
| 0052 | Milestone 12: Observability, Cost & Safety | verified | task/0052-run-reporting | Run Reporting |
| 0053 | Milestone 12: Observability, Cost & Safety | verified | task/0053-per-provider-outcome-telemetry | Per-Provider Outcome Telemetry |
| 0054 | Milestone 13: Multi-Model Orchestration | verified | task/0054-cross-provider-review-policy | Cross-Provider Review Policy |
| 0055 | Milestone 13: Multi-Model Orchestration | verified | task/0055-ensemble-and-judge | Ensemble & Judge on `tier:core` |
| 0056 | Milestone 13: Multi-Model Orchestration | verified | task/0056-outcome-driven-routing | Outcome-Driven Routing |
| 0057 | Milestone 13: Multi-Model Orchestration | verified | task/0057-cost-quality-routing-config | Cost/Quality Routing Config |
| 0058 | Milestone 14: Documentation, Examples & Trust | verified | task/0058-docs-site-and-quickstart | Docs Site & Quickstart |
| 0059 | Milestone 14: Documentation, Examples & Trust | verified | task/0059-config-reference | Config Reference |
| 0060 | Milestone 14: Documentation, Examples & Trust | verified | task/0060-authoring-guides | Adapter & Provider Authoring Guides |
| 0061 | Milestone 14: Documentation, Examples & Trust | verified | task/0061-example-attachments | Example Attachments |
| 0062 | Milestone 14: Documentation, Examples & Trust | verified | task/0062-security-and-trust-model | Security & Trust Model |
| 0063 | Milestone 15: V1 Hardening & Release | implemented | task/0063-end-to-end-dogfood | End-to-End External Dogfood |
| 0064 | Milestone 15: V1 Hardening & Release | verified | task/0064-security-review | Security Review |
| 0065 | Milestone 15: V1 Hardening & Release | implemented | task/0065-cost-latency-benchmarks | Cost & Latency Benchmarks |
| 0066 | Milestone 15: V1 Hardening & Release | implemented | task/0066-release-1-0-0 | Release 1.0.0 |
| 0067 | Milestone 15: V1 Hardening & Release | verified | task/0067-upgrade-and-migration-path | Upgrade & Migration Path |
| 0068 | Milestone 16: Loop Control & Observability CLI | verified | task/0068-cli-loop-introspection | Loop Introspection (`loopdog loops list` / `loopdog loops show`) |
| 0069 | Milestone 16: Loop Control & Observability CLI | verified | task/0069-cli-run-history-and-tracing | Run History & Tracing (`loopdog runs list` / `loopdog runs show`) |
| 0070 | Milestone 16: Loop Control & Observability CLI | verified | task/0070-cli-trigger-dryrun-and-tail | Trigger, Dry-Run & Tail (`loopdog run` / `loopdog tail` / `loopdog watch`) |
| 0071 | Milestone 16: Loop Control & Observability CLI | verified | task/0071-cli-fleet-status-and-control | Fleet Status & Control (`loopdog status` + control verbs) |
| 0072 | Milestone 16: Loop Control & Observability CLI | verified | task/0072-cli-prompt-policy-inspection | Prompt & Policy Inspection (`loopdog prompts show/diff/edit/history`) |
| 0078 | Milestone 16: Loop Control & Observability CLI | verified | task/0078-custom-loop-authoring | Custom Loop Authoring (`loopdog loops new` questionnaire) |
| 0079 | Milestone 17: Authorization & Trigger Control | verified | task/0079-actor-authorization-policy | Actor Authorization Policy (WHO) |
| 0080 | Milestone 17: Authorization & Trigger Control | verified | task/0080-approval-gate-and-parked-items | Approval Gate & Parked Items (WHEN / release) |
| 0081 | Milestone 17: Authorization & Trigger Control | verified | task/0081-trigger-source-and-bot-controls | Trigger Source & Bot Controls (WHAT) |
| 0082 | Milestone 17: Authorization & Trigger Control | verified | task/0082-rate-limits-and-schedule-windows | Rate Limits & Schedule Windows (WHEN) |
| 0083 | Milestone 18: Test & Simulation Harness | verified | task/0083-fake-github | Fake GitHub (in-memory `GitHubPort`) |
| 0084 | Milestone 18: Test & Simulation Harness | verified | task/0084-fake-and-replay-backends | Fake & Replay Backends |
| 0085 | Milestone 18: Test & Simulation Harness | verified | task/0085-scenario-runner-and-goldens | Scenario Runner & Golden Assertions |
| 0086 | Milestone 18: Test & Simulation Harness | verified | task/0086-simulation-and-fault-injection | Simulation & Fault Injection |
| 0087 | Milestone 18: Test & Simulation Harness | verified | task/0087-tiered-ci-and-live-smoke | Tiered CI Wiring & Live Smoke |
| 0088 | Milestone 19: Resilience & Failure Policy | verified | task/0088-failure-taxonomy | Failure Taxonomy & Classification |
| 0089 | Milestone 19: Resilience & Failure Policy | verified | task/0089-retry-timeout-backoff | Retry, Timeout & Backoff |
| 0090 | Milestone 19: Resilience & Failure Policy | verified | task/0090-concurrency-ceiling-and-circuit-breaker | Concurrency Ceiling & Circuit Breaker |
| 0091 | Milestone 19: Resilience & Failure Policy | verified | task/0091-resilience-knobs-and-quarantine | Resilience Knobs, Quarantine & Escalation |
