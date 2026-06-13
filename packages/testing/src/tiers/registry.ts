/**
 * The five-tier test pyramid (task 0087). Tiers 1–4 are hermetic — offline,
 * quota-free, deterministic — and run on every PR. Tier 5 (live smoke) is the
 * only tier that spends real subscription quota and is gated to manual/nightly.
 *
 * Existing tiers-1–4 tests are not individually file-tagged; the load-bearing
 * split CI enforces is the coarse 1–4 (everything NOT `*.live.test.ts`) vs 5
 * (`*.live.test.ts`). The per-tier globs below classify by file-name convention
 * for reporting and future filtering; they are best-effort, not exhaustive.
 */
export type Tier = 'unit' | 'component' | 'scenario' | 'simulation' | 'live-smoke';

export type TierRequirement = 'quota' | 'network' | 'secrets';

export interface TierSpec {
  tier: Tier;
  /** 1..5 — the pyramid level. */
  level: 1 | 2 | 3 | 4 | 5;
  /** vitest globs that classify a test into this tier (by file convention). */
  include: string[];
  /** What this tier needs at runtime; tiers 1–4 require nothing (hermetic). */
  requires: TierRequirement[];
}

export const TIERS: readonly TierSpec[] = [
  {
    tier: 'unit',
    level: 1,
    include: ['packages/core/test/**/*.test.ts', 'packages/*/test/**/*.unit.test.ts'],
    requires: [],
  },
  {
    tier: 'component',
    level: 2,
    include: [
      'packages/*/test/**/*.conformance.test.ts',
      'packages/backends/test/**/*.test.ts',
      'packages/github/test/**/*.test.ts',
    ],
    requires: [],
  },
  {
    tier: 'scenario',
    level: 3,
    include: ['packages/testing/test/scenario.test.ts', 'packages/*/test/**/*.scenario.test.ts'],
    requires: [],
  },
  {
    tier: 'simulation',
    level: 4,
    include: [
      'packages/testing/test/simulation.test.ts',
      'packages/*/test/**/*.simulation.test.ts',
    ],
    requires: [],
  },
  {
    tier: 'live-smoke',
    level: 5,
    include: ['packages/*/test/**/*.live.test.ts'],
    requires: ['quota', 'network', 'secrets'],
  },
];

/** The tier-5 marker — the ONLY glob that may touch a real subscription. */
export const LIVE_GLOB = 'packages/*/test/**/*.live.test.ts';

/** Every tiers-1–4 test (all `.test.ts` that are NOT live). */
export const HERMETIC_GLOB = 'packages/*/test/**/*.test.ts';
