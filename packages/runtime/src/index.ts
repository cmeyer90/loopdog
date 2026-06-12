// @looper/runtime — the controller / composition root: the effectful
// transition pipeline, triggers + reconcile sweep, telemetry, built-in loops.
export { runLoopOnItem, runLoopOnce } from './pipeline/transition-runner.js';
export type { RunnerDeps } from './pipeline/transition-runner.js';
export { handleEvent, handleSweep } from './pipeline/controller.js';
export type { ControllerOptions, EventResult } from './pipeline/controller.js';
export { matchLoopsForEvent } from './triggers/match.js';
export { runSweep } from './sweep/sweep.js';
export type { SweepOptions, SweepSummary } from './sweep/sweep.js';
export { composeBrief, contentSha8 } from './pipeline/brief.js';
export type { BriefInputs } from './pipeline/brief.js';
export {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './pipeline/dispatch-marker.js';
export type { PendingDispatch } from './pipeline/dispatch-marker.js';
export { bumpAttempts, clearAttempts, parseAttempts } from './pipeline/attempts.js';
export { EffectGate } from './pipeline/effect-gate.js';
export { TELEMETRY_BRANCH, TelemetryBranchStore } from './telemetry/record-store.js';
export type { RunRecordStore } from './telemetry/record-store.js';
