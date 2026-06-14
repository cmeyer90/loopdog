// @loopdog/runtime — the controller / composition root: the effectful
// transition pipeline, triggers + reconcile sweep, telemetry, built-in loops.
export { runLoopOnItem, runLoopOnce } from './pipeline/transition-runner.js';
export type { RunnerDeps } from './pipeline/transition-runner.js';
export {
  createFsPromptSource,
  handleEvent,
  handleRun,
  handleSweep,
} from './pipeline/controller.js';
// Re-exported for the CLI (which may not depend on @loopdog/backends directly).
export { checkCompatibility, compose, lintPrompt, resolveArtifact } from '@loopdog/backends';
export type { Brief, ComposeContext, PromptLintIssue, PromptSource } from '@loopdog/backends';
export type { ControllerOptions, EventResult, RunResult } from './pipeline/controller.js';
export { matchLoopsForEvent } from './triggers/match.js';
export { runSweep } from './sweep/sweep.js';
export type { SweepOptions, SweepSummary } from './sweep/sweep.js';
export { composeWorkBrief, promptSourceFromReader } from './pipeline/brief.js';
export type { BriefInputs } from './pipeline/brief.js';
export {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './pipeline/dispatch-marker.js';
export type { PendingDispatch } from './pipeline/dispatch-marker.js';
export { bumpAttempts, clearAttempts, parseAttempts } from './pipeline/attempts.js';
export { EffectGate } from './pipeline/effect-gate.js';
export { syncPlanAfterTransition } from './pipeline/plan-sync.js';
export { TELEMETRY_BRANCH, TelemetryBranchStore } from './telemetry/record-store.js';
export type { RunRecordStore } from './telemetry/record-store.js';
export { aggregateOutcomes, renderRunReport } from './telemetry/aggregate.js';
export type { OutcomeAggregate } from './telemetry/aggregate.js';
export { projectBenchmark, renderBenchmarkMarkdown } from './telemetry/benchmark.js';
export type { BenchmarkReport, BenchmarkRow, BenchmarkOptions } from './telemetry/benchmark.js';
export { reviewerFor, routeBackend } from './routing/route.js';
export type { ReviewPolicy, RoutingConfig } from './routing/route.js';
export { createPreflight } from './pipeline/preflight.js';
export type { PreflightConfig, PreflightDeps } from './pipeline/preflight.js';
