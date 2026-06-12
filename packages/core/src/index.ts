// @looper/core — pure domain: state machine, transition decision logic,
// DoR/DoD gates, run-record types, and the port interfaces. No IO.

// ports
export type {
  ActorRef,
  AuthorAssociation,
  CheckConclusion,
  CheckRunSnapshot,
  CommentSnapshot,
  IssueSnapshot,
  ItemKind,
  ItemRef,
  LabelSpec,
  PullRequestSnapshot,
  RepoRef,
  ReviewSnapshot,
  ReviewState,
  TriggerEvent,
} from './ports/types.js';
export type {
  ChecksPort,
  GitHubPort,
  IdentityPort,
  IssuesPort,
  LabelsPort,
  PullsPort,
  RepoFilesPort,
} from './ports/github-port.js';
export type {
  BackendCapabilities,
  BackendId,
  CorrelationSignal,
  DispatchHandle,
  ExecutionBackend,
  IngestResult,
  WorkBrief,
} from './ports/backend.js';
export type {
  AdapterCommands,
  AdapterId,
  CommandPlan,
  CommandStep,
  DeployPlan,
  ProjectAdapter,
  ProjectProfile,
  RepoFs,
} from './ports/project-adapter.js';
export type {
  AcceptanceCriterion,
  ChecklistEntry,
  PlanRef,
  PlanStatus,
  PlanStore,
  TaskPlan,
  TaskPlanDraft,
  TaskPlanPatch,
} from './ports/plan-store.js';
export type { ResolvedSecrets, SecretBackend, SecretBackendId } from './ports/secret-backend.js';
export { scrubSecrets } from './ports/secret-backend.js';

// state machine
export {
  CLAIM_LABEL_PREFIX,
  DEFAULT_STATES,
  DEPLOY_STATES,
  LEASE_LABEL_PREFIX,
  LOCK_LABEL_PREFIX,
  OFF_RAMP_LABELS,
  OFF_RAMP_STATES,
  OPERATIONAL_LABELS,
  STATE_LABEL_PREFIX,
  isOffRamp,
  stateLabel,
  stateOfLabels,
} from './state-machine/states.js';
export type {
  EdgeValidation,
  TransitionEdge,
  TransitionTable,
} from './state-machine/transition-table.js';
export {
  DEFAULT_TRANSITION_TABLE,
  extendTable,
  validateEdge,
  validateLoopTransition,
} from './state-machine/transition-table.js';
export { planLabelReconciliation } from './state-machine/label-plan.js';

// transitions
export type {
  AuthorizationConfig,
  BlastRadiusConfig,
  GateConfig,
  LoopDefinition,
  LoopMode,
  LoopTrigger,
  ResilienceConfig,
  RiskTier,
} from './transitions/loop-definition.js';
export {
  DEFAULT_LEASE_TTL_MINUTES,
  claimLabel,
  claimMarker,
  isLeaseExpired,
  leaseExpiry,
  leaseLabel,
  lockLabel,
  parseClaims,
  parseLeaseExpiry,
  parseLocks,
  resolveClaimRace,
} from './transitions/claim-protocol.js';
export type { Decision, PreflightCheck, Verdict } from './transitions/decision.js';
export { decideTransition, standardChecks } from './transitions/decision.js';
export type { SupportedEventName } from './transitions/event-matrix.js';
export {
  EVENT_ACTION_MATRIX,
  MERGE_SOURCE,
  isSupportedEvent,
  isSupportedEventAction,
} from './transitions/event-matrix.js';

// gates
export {
  CRITERIA_CLOSE,
  CRITERIA_OPEN,
  SCOPE_CLOSE,
  SCOPE_OPEN,
  hasScopeBlock,
  parseCriteriaBlock,
  renderCriteriaBlock,
  upsertCriteriaBlock,
} from './gates/criteria.js';
export type { CriteriaParse } from './gates/criteria.js';
export type { GateResult } from './gates/dor.js';
export { DOR_FAIL_ROUTE, evaluateDor } from './gates/dor.js';
export type { DodInput } from './gates/dod.js';
export { evaluateDod } from './gates/dod.js';
export type { EffectPolicy, Mode, PlannedAction } from './gates/mode.js';
export { DEFAULT_MODE, allowedEffects } from './gates/mode.js';

// run record
export type {
  FailureClass,
  RunCost,
  RunOutcome,
  RunRecord,
  RunStep,
} from './run-record/run-record.js';
export { deriveRunId, idempotencyKey, runRecordPath } from './run-record/run-record.js';
