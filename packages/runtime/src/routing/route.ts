import type { RiskTier } from '@looper/core';
import type { OutcomeAggregate } from '../telemetry/aggregate.js';

/**
 * Multi-model orchestration policies (M13): cross-provider review pairing per
 * tier (0054) and outcome-driven routing with cost/quality knobs (0056/0057).
 * Pure functions over config + the 0053 aggregates.
 */

export interface ReviewPolicy {
  never_same_as_implementer: boolean;
  by_tier: Partial<Record<RiskTier, string>>;
}

/** Which provider reviews work implemented by `implementer` at this tier. */
export function reviewerFor(
  implementer: string,
  tier: RiskTier,
  policy: ReviewPolicy,
  rootReviewDefault?: string,
): string {
  let reviewer = policy.by_tier[tier] ?? rootReviewDefault ?? other(implementer);
  if (policy.never_same_as_implementer && reviewer === implementer) {
    reviewer = other(implementer);
  }
  return reviewer;
}

function other(backend: string): string {
  return backend === 'claude' ? 'codex' : 'claude';
}

export interface RoutingConfig {
  mode: 'static' | 'outcome';
  prefer: 'quality' | 'cost' | 'balanced';
  min_samples: number;
  pin?: Record<string, string> | undefined;
}

/**
 * Outcome-driven backend choice (0056): for a loop, pick the candidate with
 * the better logged success rate (sample floor enforced); ties + insufficient
 * data fall to the cost/quality preference (0057), then the static default.
 */
export function routeBackend(
  loop: string,
  candidates: readonly string[],
  aggregates: readonly OutcomeAggregate[],
  config: RoutingConfig,
  staticDefault: string,
): { backend: string; reason: string } {
  const pinned = config.pin?.[loop];
  if (pinned) return { backend: pinned, reason: `pinned in routing.pin.${loop}` };
  if (config.mode !== 'outcome') return { backend: staticDefault, reason: 'static selection' };

  const scored = candidates
    .map((backend) => {
      const agg = aggregates.find((a) => a.loop === loop && a.backend === backend);
      const decided = agg ? agg.done + agg.failed + agg.escalated : 0;
      return {
        backend,
        rate: agg && decided >= config.min_samples ? agg.successRate : null,
      };
    })
    .filter((s): s is { backend: string; rate: number } => s.rate !== null);

  if (scored.length > 0) {
    scored.sort((a, b) => b.rate - a.rate || a.backend.localeCompare(b.backend));
    const best = scored[0]!;
    if (scored.length === 1 || best.rate > scored[1]!.rate) {
      return {
        backend: best.backend,
        reason: `outcome routing: ${(best.rate * 100).toFixed(0)}% success over the ledger`,
      };
    }
  }
  // tie or insufficient data → the cost/quality knob decides
  const byPreference =
    config.prefer === 'cost'
      ? ['codex', 'claude'] // mention dispatch is the cheaper surface
      : config.prefer === 'quality'
        ? ['claude', 'codex']
        : [staticDefault];
  const pick = byPreference.find((b) => candidates.includes(b)) ?? staticDefault;
  return { backend: pick, reason: `preference '${config.prefer}' (no outcome signal)` };
}
