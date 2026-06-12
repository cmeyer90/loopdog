/**
 * Provider cloud env & secret config (task 0030): render the declared
 * `work_cell.env` block into what each backend can actually deliver — and be
 * HONEST about what it can't (Claude values live in Claude's web UI; Codex
 * strips secrets before the agent phase; only self-hosted injects for real).
 */

export type Sensitivity = 'build' | 'runtime' | 'sensitive';

export type EnvEntry = {
  sensitivity: Sensitivity;
} & (
  | { value: string }
  | { from_env: string }
  | { from_actions_secret: string }
  | { provider_configured: true }
);

export interface WorkCellEnvConfig {
  setup?: string | undefined;
  env?: Record<string, EnvEntry> | undefined;
  backends?: Record<string, { setup?: string; env?: Record<string, EnvEntry> }> | undefined;
}

export interface ResolvedEnv {
  setup: string | undefined;
  /** Values the controller can actually render for this backend. */
  env: Record<string, string>;
  /** Names the backend cannot receive at dispatch (with the reason). */
  dropped: Array<{ name: string; reason: string }>;
  /** Names the operator must configure in the provider's cloud UI (doctor list). */
  providerChecklist: string[];
  /** Honest warnings (e.g. sensitive values routed to self-hosted). */
  warnings: string[];
  /** Codex: vars that exist only during setup (stripped before agent phase). */
  setupOnly: string[];
}

export function resolveWorkCellEnv(
  config: WorkCellEnvConfig,
  backend: string,
  controllerEnv: NodeJS.ProcessEnv = process.env,
): ResolvedEnv {
  const override = config.backends?.[backend];
  const merged: Record<string, EnvEntry> = { ...config.env, ...override?.env };
  const result: ResolvedEnv = {
    setup: override?.setup ?? config.setup,
    env: {},
    dropped: [],
    providerChecklist: [],
    warnings: [],
    setupOnly: [],
  };

  for (const [name, entry] of Object.entries(merged)) {
    if (entry.sensitivity === 'sensitive' && backend !== 'self-hosted') {
      result.warnings.push(
        `${name} is marked sensitive — production-grade secrets must not reside in ` +
          `provider cloud; route this loop to the self-hosted backend`,
      );
    }

    if ('provider_configured' in entry) {
      // The value lives in the provider's cloud environment (Claude web UI).
      result.providerChecklist.push(name);
      continue;
    }

    if (backend === 'claude') {
      // M00 decision: looper never forwards values into Claude at /fire time.
      result.dropped.push({
        name,
        reason:
          'Claude routines receive no env at dispatch — configure it in the Claude cloud environment (mark provider_configured)',
      });
      result.providerChecklist.push(name);
      continue;
    }

    let value: string | undefined;
    if ('value' in entry) value = entry.value;
    else if ('from_env' in entry) value = controllerEnv[entry.from_env];
    else if ('from_actions_secret' in entry) value = controllerEnv[entry.from_actions_secret];

    if (value === undefined) {
      result.dropped.push({ name, reason: 'source not present in the controller environment' });
      continue;
    }
    result.env[name] = value;
    if (backend === 'codex') {
      // Codex strips secrets before the agent phase: everything is setup-only.
      result.setupOnly.push(name);
    }
  }
  return result;
}
