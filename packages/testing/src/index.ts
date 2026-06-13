// @looper/testing — dev-only fakes + scenario/simulation harness. Not shipped.
export { FakeGitHub } from './fake-github/fake-github.js';
export { FakeBackend } from './fake-backends/fake-backend.js';
export type { FakeBehavior } from './fake-backends/fake-backend.js';
export { ReplayBackend } from './fake-backends/replay-backend.js';
export type { Cassette, CassetteExchange } from './fake-backends/replay-backend.js';
export { InMemoryRunRecordStore } from './fake-backends/in-memory-records.js';
export { claudeLike, codexLike, selfHostedLike } from './fake-backends/capability-presets.js';
export { runBackendConformance } from './conformance/backend.js';
export type { BackendConformanceOpts } from './conformance/backend.js';
export {
  ADAPTER_FIXTURES,
  fakeCommandRunner,
  repoFsFixture,
  runAdapterConformance,
} from './conformance/adapter.js';
export type { AdapterConformanceOpts, FakeCommandRunner } from './conformance/adapter.js';

// --- scenario runner + goldens (0085) ---
export { runScenario, loadScenario, assertGolden } from './scenario/runner.js';
export type {
  Scenario,
  ScenarioStep,
  ScenarioWorld,
  ScenarioResult,
  GoldenOpts,
} from './scenario/runner.js';
export { snapshotGolden, goldenJson, diffGolden } from './scenario/snapshot.js';
export type { Golden, GoldenDiff } from './scenario/snapshot.js';

// --- simulation + fault injection + invariants (0086) ---
export { VirtualClock } from './simulation/clock.js';
export { Sim, SimViolation } from './simulation/sim.js';
export type { Action, StepResult, SimOptions } from './simulation/sim.js';
export {
  ALL_INVARIANTS,
  checkInvariants,
  noDoubleDispatch,
  idempotentIngest,
  claimExclusivity,
  noStrandedItems,
  monotonicState,
} from './simulation/invariants.js';
export type { Invariant, InvariantInput, Violation } from './simulation/invariants.js';
export {
  eventStorm,
  raceEventSweep,
  duplicateWebhook,
  sweepRecovery,
  crashMidRun,
} from './simulation/faults.js';
export { fuzz } from './simulation/fuzz.js';
export type { FuzzConfig, FuzzResult, FuzzViolation, FuzzWorld } from './simulation/fuzz.js';

// --- tiered CI selection + hermeticity guards (0087) ---
export {
  TIERS,
  LIVE_GLOB,
  HERMETIC_GLOB,
  parseTierSelector,
  tierGlobs,
  selectorRequiresIO,
  tiersForSelector,
  installNetworkGuard,
  assertNoSecrets,
  FORBIDDEN_SECRET_ENV,
} from './tiers/index.js';
export type {
  Tier,
  TierSpec,
  TierRequirement,
  TierSelector,
  TierGlobs,
  NetworkGuard,
  SecretAbsenceResult,
} from './tiers/index.js';

// --- live smoke harness + drift report (0087, tier 5) ---
export { runLiveSmoke, cleanupScratch } from './live-smoke/harness.js';
export type { LiveSmokeConfig, SmokeResult, SmokeStatus } from './live-smoke/harness.js';
export { classifyDrift } from './live-smoke/drift-report.js';
export type {
  DriftReport,
  DriftFinding,
  DriftKind,
  ObservedShape,
  ExpectedShape,
} from './live-smoke/drift-report.js';
