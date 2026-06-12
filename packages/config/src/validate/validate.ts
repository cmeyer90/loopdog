import type { LoopDefinition, TransitionTable } from '@looper/core';
import {
  DEFAULT_TRANSITION_TABLE,
  extendTable,
  isSupportedEventAction,
  selectBackend,
  validateLoopTransition,
} from '@looper/core';
import { loopConfigSchema, type LoopConfig } from '../schema/loop.js';
import { rootConfigSchema, type RootConfig } from '../schema/root.js';
import { validateCron } from '../schema/cron.js';
import type { DiscoveredTree } from '../load/discover.js';

/** Per-field, actionable validation errors (task 0006): file + path + message. */
export interface ConfigError {
  file: string;
  path: string;
  message: string;
}

export type ConfigWarning = ConfigError;

export interface ValidationResult {
  ok: boolean;
  errors: ConfigError[];
  warnings: ConfigWarning[];
  config?: ResolvedConfig;
}

/** The fully-resolved configuration every consumer reads. */
export interface ResolvedConfig {
  root: RootConfig;
  /** Resolved per-loop definitions (root defaults merged, camelCase domain shape). */
  loops: LoopDefinition[];
  /** Raw per-loop file configs (for tooling that needs file-shape access). */
  loopConfigs: Map<string, LoopConfig>;
  /** The transition table in force (defaults + every loop's `declares`). */
  table: TransitionTable;
}

export function validateConfig(tree: DiscoveredTree): ValidationResult {
  const errors: ConfigError[] = [];
  const warnings: ConfigWarning[] = [];

  // ---- root ----
  if (tree.root === null) {
    errors.push({
      file: tree.rootFile,
      path: '',
      message: 'missing or unparseable .looper/looper.yml (run `looper init`)',
    });
    return { ok: false, errors, warnings };
  }
  const rootParsed = rootConfigSchema.safeParse(tree.root);
  if (!rootParsed.success) {
    for (const issue of rootParsed.error.issues) {
      errors.push({ file: tree.rootFile, path: issue.path.join('.'), message: issue.message });
    }
    return { ok: false, errors, warnings };
  }
  const root = rootParsed.data;

  // ---- per-loop schema pass ----
  const parsed: Array<{ folder: string; file: string; cfg: LoopConfig }> = [];
  for (const loop of tree.loops) {
    if (loop.parseError) {
      errors.push({ file: loop.file, path: '', message: `YAML parse error: ${loop.parseError}` });
      continue;
    }
    if (loop.raw === null) {
      errors.push({ file: loop.file, path: '', message: 'missing loop.yml in loop folder' });
      continue;
    }
    const result = loopConfigSchema.safeParse(loop.raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ file: loop.file, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    parsed.push({ folder: loop.folder, file: loop.file, cfg: result.data });

    if (!loop.promptExists) {
      errors.push({
        file: loop.promptPath,
        path: '',
        message: `prompt.md is required next to loop.yml (the loop's versioned brief)`,
      });
    }
  }

  // ---- cross-field validation ----
  const seen = new Set<string>();
  // The table in force = defaults + every loop's declared states/edges.
  let table = DEFAULT_TRANSITION_TABLE;
  for (const { cfg } of parsed) {
    if (cfg.declares) table = extendTable(table, cfg.declares);
  }

  for (const { folder, file, cfg } of parsed) {
    if (cfg.name !== folder) {
      errors.push({
        file,
        path: 'name',
        message: `name '${cfg.name}' must equal the folder name '${folder}'`,
      });
    }
    if (seen.has(cfg.name)) {
      errors.push({ file, path: 'name', message: `duplicate loop name '${cfg.name}'` });
    }
    seen.add(cfg.name);

    if (cfg.trigger.github_event !== undefined) {
      const actions = Array.isArray(cfg.trigger.action)
        ? cfg.trigger.action
        : cfg.trigger.action !== undefined
          ? [cfg.trigger.action]
          : [undefined];
      for (const action of actions) {
        if (!isSupportedEventAction(cfg.trigger.github_event, action)) {
          errors.push({
            file,
            path: 'trigger',
            message:
              `'${cfg.trigger.github_event}${action ? `.${action}` : ''}' is not in the V1 ` +
              `event/action matrix (note: merge = pull_request.closed + predicate.merged; ` +
              `item labels = issues.labeled / pull_request.labeled, not 'label')`,
          });
        }
      }
    }
    if (cfg.trigger.cron !== undefined) {
      const check = validateCron(cfg.trigger.cron);
      if (!check.ok) {
        errors.push({ file, path: 'trigger.cron', message: check.error ?? 'invalid cron' });
      }
    }

    const edge = validateLoopTransition(table, cfg.transition, {
      dispatches: cfg.expects !== 'none',
    });
    if (!edge.legal) {
      errors.push({
        file,
        path: 'transition',
        message: edge.reason ?? 'illegal transition',
      });
    }
    if (cfg.transition.fallback && cfg.transition.fallback !== cfg.transition.from) {
      const fb = validateLoopTransition(
        table,
        { from: cfg.transition.from, to: cfg.transition.fallback },
        { dispatches: cfg.expects !== 'none' },
      );
      if (!fb.legal) {
        errors.push({
          file,
          path: 'transition.fallback',
          message: fb.reason ?? 'illegal fallback transition',
        });
      }
    }

    if (
      root.backends.zdr &&
      (cfg.backend === 'claude' || (!cfg.backend && root.backends.default === 'claude'))
    ) {
      errors.push({
        file,
        path: 'backend',
        message:
          'Zero-Data-Retention org: Claude cloud routines are excluded — select the ' +
          'self-hosted backend for this loop (`looper connect default self-hosted`)',
      });
    }

    if (cfg.expects !== 'none' && !cfg.backend && !root.backends.default) {
      errors.push({
        file,
        path: 'backend',
        message: `loop dispatches a work cell ('expects: ${cfg.expects}') but no backend is set and no root default exists`,
      });
    }

    if (!cfg.gates.require_dor && cfg.expects === 'pull-request') {
      warnings.push({
        file,
        path: 'gates.require_dor',
        message: `'require_dor: false' — this loop will implement issues with no acceptance criteria`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  // ---- resolve (defaults merge: per-loop > root defaults > built-in) ----
  const loops: LoopDefinition[] = [];
  const loopConfigs = new Map<string, LoopConfig>();
  for (const { cfg } of parsed) {
    loopConfigs.set(cfg.name, cfg);
    loops.push(resolveLoop(root, cfg));
  }
  return {
    ok: true,
    errors,
    warnings,
    config: { root, loops, loopConfigs, table },
  };
}

function resolveLoop(root: RootConfig, cfg: LoopConfig): LoopDefinition {
  const trigger =
    cfg.trigger.cron !== undefined
      ? ({ kind: 'cron', schedule: cfg.trigger.cron } as const)
      : ({
          kind: 'github_event',
          events: (Array.isArray(cfg.trigger.action)
            ? cfg.trigger.action
            : cfg.trigger.action !== undefined
              ? [cfg.trigger.action]
              : [undefined]
          ).map((a) => (a ? `${cfg.trigger.github_event}.${a}` : cfg.trigger.github_event!)),
          predicate: cfg.trigger.predicate,
          filter: cfg.trigger.filter,
        } as const);

  return {
    name: cfg.name,
    trigger,
    transition: cfg.transition,
    // Full 0023 precedence: loop per-stage -> loop default -> root per-stage
    // -> root default -> 'claude' (stage derived from the transition).
    backend: selectBackend(root.backends, {
      backend: cfg.backend,
      reviewBackend: cfg.review_backend,
      transition: cfg.transition,
    }),
    reviewBackend: cfg.review_backend,
    gates: {
      requireDor: cfg.gates.require_dor,
      requireCi: cfg.gates.require_ci,
      tier: cfg.gates.tier,
      requiredChecks: cfg.gates.required_checks,
    },
    blastRadius: {
      maxFiles: cfg.blast_radius?.max_files ?? root.defaults.blast_radius.max_files,
      maxDiffLines: cfg.blast_radius?.max_diff ?? root.defaults.blast_radius.max_diff,
      forbiddenPaths: cfg.blast_radius?.forbidden_paths,
    },
    authorization: resolveAuthorization(root, cfg),
    resilience: resolveResilience(root, cfg),
    promptPath: `.looper/loops/${cfg.name}/prompt.md`,
    mode: cfg.mode ?? root.defaults.mode,
    expects: cfg.expects === 'none' ? undefined : cfg.expects,
    serializeBy: cfg.serialize_by,
    requires: cfg.requires
      ? { liveSecrets: cfg.requires.live_secrets, network: cfg.requires.network }
      : undefined,
  };
}

/** Spread-merge that never lets an absent/undefined override a default. */
function mergeDefined<T extends object>(
  base: T,
  override: { [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function resolveAuthorization(root: RootConfig, cfg: LoopConfig): LoopDefinition['authorization'] {
  const a = mergeDefined(root.authorization, cfg.authorization);
  return {
    actors: a.actors,
    allow: a.allow,
    deny: a.deny,
    onUnauthorized: a.on_unauthorized,
    approvalLabel: a.approval_label,
    allowedBots: a.allowed_bots,
    rateLimit: a.rate_limit
      ? {
          perActorPerDay: a.rate_limit.per_actor_per_day,
          globalPerHour: a.rate_limit.global_per_hour,
        }
      : undefined,
    scheduleWindow: a.schedule_window,
  };
}

function resolveResilience(root: RootConfig, cfg: LoopConfig): LoopDefinition['resilience'] {
  const r = mergeDefined(root.resilience, cfg.resilience);
  return {
    retries: r.retries
      ? {
          max: r.retries.max,
          backoff: r.retries.backoff,
          baseSeconds: parseDuration(r.retries.base),
          capSeconds: parseDuration(r.retries.cap),
        }
      : undefined,
    dispatchTimeoutMinutes: r.dispatch_timeout
      ? Math.round(parseDuration(r.dispatch_timeout) / 60)
      : undefined,
    maxAttemptsPerItem: r.max_attempts_per_item,
    maxFixAttempts: r.max_fix_attempts,
    maxInFlight: r.max_in_flight
      ? { global: r.max_in_flight.global, perLoop: r.max_in_flight.per_loop }
      : undefined,
    circuitBreaker: r.circuit_breaker
      ? {
          consecutiveFailures: r.circuit_breaker.consecutive_failures,
          cooldownMinutes: Math.round(parseDuration(r.circuit_breaker.cooldown) / 60),
        }
      : undefined,
    onFailure: r.on_failure,
    escalateTo: r.escalate_to,
  };
}

/** `30s` / `10m` / `1h` → seconds. Unknown suffix → treated as seconds. */
export function parseDuration(text: string): number {
  const m = text.trim().match(/^(\d+)\s*([smh]?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'h':
      return n * 3600;
    case 'm':
      return n * 60;
    default:
      return n;
  }
}
