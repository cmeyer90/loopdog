// @looper/github — the GitHub port: Octokit wrapper over GITHUB_TOKEN,
// labels/claims IO, event parsing, identity.
export { OctokitGitHub } from './client/octokit-github.js';
export { acquireClaim, clearExpiredClaim, releaseClaim, renewLease } from './claims/claims.js';
export type { ClaimOptions, ClaimResult } from './claims/claims.js';
export { reconcileLabels } from './labels/reconcile.js';
export { upsertMarkedComment } from './comments/upsert.js';
export { SUPPORTED_EVENTS, parseActionsEvent } from './events/parse.js';
export { ACTIONS_BOT, parseRepoFromRemoteUrl, resolveGitHubAuth } from './identity/identity.js';
export type { ResolvedAuth } from './identity/identity.js';
