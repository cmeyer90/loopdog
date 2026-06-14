// @loopdog/backends — execution-backend implementations: claude (/fire),
// codex (@codex mention), self-hosted (worker dispatch) + the shared
// correlation primitive, brief composer, selection/auth, and registry.
export { correlatePr, findCorrelatedPr, ingestViaCorrelation } from './correlation/correlate.js';
export type { MatchKind } from './correlation/correlate.js';
export {
  BUILTIN_POLICIES,
  PLACEHOLDERS,
  compose,
  lintPrompt,
  resolveArtifact,
  substitute,
} from './brief/compose.js';
export type { Brief, ComposeContext, PromptLintIssue, PromptSource } from './brief/compose.js';
export {
  CLAUDE_FIRE_TOKEN_REF,
  CLAUDE_FIRE_URL_REF,
  CLAUDE_ROUTINE_BETA,
  ClaudeBackend,
} from './claude/claude-backend.js';
export { CodexBackend } from './codex/codex-backend.js';
export {
  DEFAULT_API_KEY_SECRET,
  SELF_HOSTED_WORKER_WORKFLOW,
  SelfHostedBackend,
  agentCommand,
} from './self-hosted/self-hosted-backend.js';
export { checkCompatibility } from './interface/compatibility.js';
export type { CapabilityMismatch } from './interface/compatibility.js';
export {
  BackendAuthError,
  UnknownBackendError,
  deriveStage,
  resolveAuth,
  selectBackend,
} from './selection/select.js';
export type { BackendAuth, SecretRef, Stage } from './selection/select.js';
export { createBackendRegistry } from './registry/registry.js';
export type { RegistryOptions } from './registry/registry.js';
export { resolveWorkCellEnv } from './work-cell/provider-env.js';
export type {
  EnvEntry,
  ResolvedEnv,
  Sensitivity,
  WorkCellEnvConfig,
} from './work-cell/provider-env.js';
export {
  SecretResolutionError,
  actionsSecretStore,
  createSecretStore,
  dopplerSecretStore,
  oidcSecretStore,
  vaultSecretStore,
} from './self-hosted/secrets.js';
export type { ResolvedSecret, SecretRefSpec, SecretStore } from './self-hosted/secrets.js';
export { Scrubber } from './self-hosted/scrubber.js';
