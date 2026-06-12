// @looper/config — root looper.yml + per-loop loop.yml schemas, discovery,
// validation, and resolution into @looper/core domain shapes.
export { rootConfigSchema, authorizationSchema, resilienceSchema } from './schema/root.js';
export type { RootConfig } from './schema/root.js';
export { loopConfigSchema } from './schema/loop.js';
export type { LoopConfig } from './schema/loop.js';
export { isCronDue, normalizeCron, validateCron } from './schema/cron.js';
export type { CronCheck } from './schema/cron.js';
export { LOOPER_DIR, discoverConfig } from './load/discover.js';
export type { DiscoveredLoop, DiscoveredTree } from './load/discover.js';
export { parseDuration, validateConfig } from './validate/validate.js';
export type {
  ConfigError,
  ConfigWarning,
  ResolvedConfig,
  ValidationResult,
} from './validate/validate.js';

import { discoverConfig } from './load/discover.js';
import { validateConfig } from './validate/validate.js';
import type { ValidationResult } from './validate/validate.js';

/** Discover + validate + resolve in one call (what most consumers want). */
export async function loadConfig(repoDir: string): Promise<ValidationResult> {
  return validateConfig(await discoverConfig(repoDir));
}
