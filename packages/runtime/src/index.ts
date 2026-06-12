// @looper/runtime — the controller / composition root: the effectful
// transition pipeline, triggers + reconcile sweep, telemetry, built-in loops.
export { runLoopOnce } from './pipeline/transition-runner.js';
export type { RunnerDeps } from './pipeline/transition-runner.js';
export { composeBrief, contentSha8 } from './pipeline/brief.js';
export type { BriefInputs } from './pipeline/brief.js';
export {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './pipeline/dispatch-marker.js';
export type { PendingDispatch } from './pipeline/dispatch-marker.js';
export { bumpAttempts, clearAttempts, parseAttempts } from './pipeline/attempts.js';
export { TELEMETRY_BRANCH, TelemetryBranchStore } from './telemetry/record-store.js';
export type { RunRecordStore } from './telemetry/record-store.js';
