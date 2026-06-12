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
    })
    .default({}),
  authorization: authorizationSchema.default({}),
  resilience: resilienceSchema.default({}),
  adapter: z.string().default('auto'),
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
