import { z } from 'zod';
import { authorizationSchema, resilienceSchema } from './root.js';

/** Schema for a per-loop `.loopdog/loops/<name>/loop.yml` (task 0006). */

const triggerSchema = z
  .object({
    /** Event kind — e.g. `pull_request` (validated against the 0008 matrix). */
    github_event: z.string().optional(),
    action: z.union([z.string(), z.array(z.string())]).optional(),
    /** e.g. `{ merged: true }` for the synthetic merge source. */
    predicate: z.record(z.string(), z.unknown()).optional(),
    /** `hourly` | `daily` | `weekly` | a cron expression. */
    cron: z.string().optional(),
    filter: z.object({ author: z.string().optional(), label: z.string().optional() }).optional(),
  })
  .superRefine((t, ctx) => {
    const kinds = [t.github_event !== undefined, t.cron !== undefined].filter(Boolean).length;
    if (kinds !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one trigger kind required: 'github_event' or 'cron'",
      });
    }
    if (t.cron !== undefined && (t.action !== undefined || t.predicate !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'action'/'predicate' only apply to github_event triggers",
      });
    }
  });

export const loopConfigSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'loop names are kebab-case ([a-z0-9-])'),
  trigger: triggerSchema,
  transition: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    fallback: z.string().min(1).optional(),
  }),
  backend: z.enum(['claude', 'codex', 'self-hosted']).optional(),
  /** Reviewer backend for cross-provider review loops (M10/M13). */
  review_backend: z.enum(['claude', 'codex', 'self-hosted']).optional(),
  adapter: z.string().optional(),
  /** What the dispatched work cell produces; 'none' = deterministic transition. */
  expects: z.enum(['pull-request', 'comment', 'plan-update', 'none']).default('none'),
  gates: z
    .object({
      require_dor: z.boolean().default(true),
      require_ci: z.boolean().default(true),
      tier: z.enum(['safe', 'default', 'core']).default('default'),
      draft_pr: z.boolean().default(false),
      only: z.string().optional(),
      required_checks: z.array(z.string()).optional(),
    })
    .default({}),
  authorization: authorizationSchema.partial().optional(),
  resilience: resilienceSchema.partial().optional(),
  blast_radius: z
    .object({
      max_files: z.number().int().min(1).optional(),
      max_diff: z.number().int().min(1).optional(),
      forbidden_paths: z.array(z.string()).optional(),
    })
    .optional(),
  serialize_by: z.string().optional(),
  /** Work-cell needs, checked against backend capabilities (0021). */
  requires: z
    .object({
      live_secrets: z.boolean().optional(),
      network: z.boolean().optional(),
    })
    .optional(),
  /** Dual-attempt + judge (M13 - 0055). Expensive; tier:core only. */
  ensemble: z
    .object({
      enabled: z.boolean().default(false),
      judge: z.enum(['claude', 'codex', 'self-hosted']).optional(),
    })
    .optional(),
  mode: z.enum(['dry-run', 'suggest', 'act']).optional(),
  /** Custom states/edges this loop adds to the transition table (0011). */
  declares: z
    .object({
      states: z.array(z.string()).default([]),
      edges: z
        .array(z.object({ from: z.string(), to: z.string(), by: z.string().default('custom') }))
        .default([]),
    })
    .optional(),
});

export type LoopConfig = z.infer<typeof loopConfigSchema>;
