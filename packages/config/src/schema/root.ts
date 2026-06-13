import { z } from 'zod';

/** Schema for the root `.looper/looper.yml` (task 0006) — global defaults. */

const budgetCeiling = z.object({
  max_dispatches: z.number().int().min(0).default(0), // 0 = unlimited
  max_usd: z.number().min(0).default(0),
});

export const authorizationSchema = z.object({
  actors: z.enum(['anyone', 'org-members', 'collaborators', 'allowlist']).default('collaborators'),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  on_unauthorized: z.enum(['park', 'ignore', 'comment']).default('park'),
  approval_label: z.string().default('looper:approved'),
  allowed_bots: z.array(z.string()).default([]),
  rate_limit: z
    .object({
      per_actor_per_day: z.number().int().min(1).optional(),
      global_per_hour: z.number().int().min(1).optional(),
    })
    .optional(),
  schedule_window: z
    .object({
      days: z.array(z.string()).optional(),
      hours: z.string().optional(),
      tz: z.string().optional(),
    })
    .optional(),
});

export const resilienceSchema = z.object({
  retries: z
    .object({
      max: z.number().int().min(0).default(2),
      backoff: z.enum(['exponential', 'fixed']).default('exponential'),
      base: z.string().default('30s'),
      cap: z.string().default('10m'),
    })
    .default({}),
  dispatch_timeout: z.string().default('30m'),
  max_attempts_per_item: z.number().int().min(1).default(3),
  max_fix_attempts: z.number().int().min(0).default(2),
  max_in_flight: z
    .object({
      global: z.number().int().min(1).default(10),
      per_loop: z.number().int().min(1).default(4),
    })
    .default({}),
  circuit_breaker: z
    .object({
      consecutive_failures: z.number().int().min(1).default(5),
      cooldown: z.string().default('1h'),
    })
    .default({}),
  on_failure: z.enum(['needs-human', 'retry', 'abandon']).default('needs-human'),
  escalate_to: z.string().optional(),
});

export const rootConfigSchema = z.object({
  version: z.literal(1),
  backends: z
    .object({
      default: z.enum(['claude', 'codex', 'self-hosted']).default('claude'),
      /** Default backend for the review stage (cross-provider review, 0023). */
      review: z.enum(['claude', 'codex', 'self-hosted']).optional(),
      /** Zero-Data-Retention org: Claude cloud routines are excluded. */
      zdr: z.boolean().default(false),
      self_hosted: z
        .object({
          agent: z.enum(['claude', 'codex']).default('claude'),
          api_key_secret: z.string().default('LOOPER_MODEL_API_KEY'),
        })
        .default({}),
    })
    .default({}),
  plan_store: z
    .union([
      z.string().transform((path) => ({ path, format_version: 1 })),
      z.object({
        path: z.string().default('.looper/plans'),
        format_version: z.number().int().min(1).default(1),
      }),
    ])
    .default({ path: '.looper/plans', format_version: 1 }),
  sweep: z
    .object({
      interval: z.string().default('*/5 * * * *'),
      max_candidates_per_tick: z.number().int().min(1).default(20),
      max_candidates_per_state: z.number().int().min(1).default(10),
    })
    .default({}),
  risk_tiers: z
    .object({
      safe: z.array(z.string()).default([]),
      core: z.array(z.string()).default([]),
    })
    .default({}),
  budgets: z
    .object({
      window: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
      global: budgetCeiling.default({}),
      per_loop: budgetCeiling.default({}),
      on_exceeded: z.enum(['park', 'needs-human']).default('park'),
    })
    .default({}),
  kill_switch: z
    .object({
      variable: z.string().default('LOOPER_KILL'),
      label: z.string().default('looper:stop'),
    })
    .default({}),
  quota: z
    .object({
      window: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
      on_exceeded: z.enum(['defer', 'park']).default('defer'),
      /** Per-backend cap overrides (0075): higher tiers raise the defaults. */
      backends: z
        .record(
          z.string(),
          z.object({
            window: z.string().optional(),
            max_dispatches: z.number().int().min(0).optional(),
          }),
        )
        .optional(),
    })
    .default({}),
  /** Cost/quality routing knobs (M13 - 0056/0057). */
  routing: z
    .object({
      mode: z.enum(['static', 'outcome']).default('static'),
      prefer: z.enum(['quality', 'cost', 'balanced']).default('balanced'),
      min_samples: z.number().int().min(1).default(5),
      pin: z.record(z.string(), z.enum(['claude', 'codex', 'self-hosted'])).optional(),
    })
    .default({}),
  /** Cross-provider review pairings per risk tier (M13 - 0054). */
  review_policy: z
    .object({
      never_same_as_implementer: z.boolean().default(true),
      by_tier: z
        .object({
          safe: z.enum(['claude', 'codex', 'self-hosted']).optional(),
          default: z.enum(['claude', 'codex', 'self-hosted']).optional(),
          core: z.enum(['claude', 'codex', 'self-hosted']).optional(),
        })
        .default({}),
    })
    .default({}),
  authorization: authorizationSchema.default({}),
  resilience: resilienceSchema.default({}),
  adapter: z.string().default('auto'),
  adapter_options: z
    .object({
      package_manager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).optional(),
      runner: z.enum(['uv', 'poetry', 'pip']).optional(),
      commands: z
        .record(
          z.enum(['build', 'test', 'lint', 'run', 'deploy']),
          z.union([z.string(), z.array(z.string()), z.null()]),
        )
        .optional(),
      detect: z
        .object({
          confidence_floor: z.number().min(0).max(1).default(0.5),
          disable: z.array(z.string()).default([]),
        })
        .default({}),
    })
    .default({}),
  work_cell: z
    .object({
      setup: z.string().optional(),
      env: z
        .record(
          z.string(),
          z
            .object({
              value: z.string().optional(),
              from_env: z.string().optional(),
              from_actions_secret: z.string().optional(),
              provider_configured: z.literal(true).optional(),
              sensitivity: z.enum(['build', 'runtime', 'sensitive']).default('build'),
            })
            .refine(
              (e) =>
                [e.value, e.from_env, e.from_actions_secret, e.provider_configured].filter(
                  (x) => x !== undefined,
                ).length === 1,
              { message: 'exactly one of value/from_env/from_actions_secret/provider_configured' },
            ),
        )
        .optional(),
      backends: z
        .record(
          z.string(),
          z.object({
            setup: z.string().optional(),
            env: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  secrets: z
    .object({
      store: z.enum(['actions', 'oidc', 'vault', 'doppler']).default('actions'),
      inject: z
        .array(
          z.object({
            name: z.string(),
            from: z.enum(['actions', 'oidc', 'vault', 'doppler']).optional(),
            key: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
  defaults: z
    .object({
      blast_radius: z
        .object({
          max_files: z.number().int().min(1).default(20),
          max_diff: z.number().int().min(1).default(400),
        })
        .default({}),
      mode: z.enum(['dry-run', 'suggest', 'act']).default('dry-run'),
    })
    .default({}),
});

export type RootConfig = z.infer<typeof rootConfigSchema>;
