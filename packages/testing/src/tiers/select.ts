import { HERMETIC_GLOB, LIVE_GLOB, TIERS, type Tier } from './registry.js';

/**
 * Tier selection (task 0087). `LOOPER_TIER` chooses which slice of the pyramid
 * runs; the vitest config maps the result to `include`/`exclude` globs.
 *
 *   1-4 (default) → hermetic tiers, EXCLUDING `*.live.test.ts`
 *   5             → ONLY `*.live.test.ts`
 *   all           → everything
 */
export type TierSelector = '1-4' | '5' | 'all';

export function parseTierSelector(raw: string | undefined): TierSelector {
  const v = (raw ?? '1-4').trim();
  if (v === '5' || v === 'live' || v === 'live-smoke') return '5';
  if (v === 'all') return 'all';
  return '1-4';
}

export interface TierGlobs {
  include: string[];
  exclude: string[];
}

/** Resolve a selector to the vitest include/exclude globs CI should run. */
export function tierGlobs(selector: TierSelector): TierGlobs {
  switch (selector) {
    case '5':
      return { include: [LIVE_GLOB], exclude: [] };
    case 'all':
      return { include: [HERMETIC_GLOB, LIVE_GLOB, 'scripts/test/**/*.test.ts'], exclude: [] };
    case '1-4':
    default:
      // Everything hermetic; the live tier is explicitly excluded so a real
      // subscription is never touched on a PR.
      return { include: [HERMETIC_GLOB, 'scripts/test/**/*.test.ts'], exclude: [LIVE_GLOB] };
  }
}

/** Whether the selected tiers require real IO (only the live tier does). */
export function selectorRequiresIO(selector: TierSelector): boolean {
  return selector !== '1-4';
}

/** Tiers included by a selector (for reporting). */
export function tiersForSelector(selector: TierSelector): Tier[] {
  if (selector === '5') return ['live-smoke'];
  const hermetic = TIERS.filter((t) => t.level <= 4).map((t) => t.tier);
  return selector === 'all' ? [...hermetic, 'live-smoke'] : hermetic;
}
