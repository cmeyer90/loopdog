import type { IssueSnapshot } from '../ports/types.js';
import type { LoopDefinition } from './loop-definition.js';
import type { TransitionTable } from '../state-machine/transition-table.js';
import { validateLoopTransition } from '../state-machine/transition-table.js';
import { isLeaseExpired, parseClaims, parseLeaseExpiry } from './claim-protocol.js';
import { stateLabel, stateOfLabels } from '../state-machine/states.js';

/**
 * Pure transition-decision logic (task 0012's deterministic heart). The
 * effectful pipeline in `@looper/runtime` builds the check list (budget,
 * authorization, resilience are composed in as pre-flight checks) and acts on
 * the decision; everything here is side-effect-free and unit-testable.
 */

export type Verdict =
  | { kind: 'proceed' }
  | { kind: 'no-op'; reason: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'park'; reason: string }
  | { kind: 'route'; to: string; reason: string }
  | { kind: 'escalate'; reason: string };

export interface PreflightCheck {
  name: string;
  verdict: Verdict;
}

export interface Decision {
  verdict: Verdict;
  /** The check that decided (or 'all-pass'). */
  decidedBy: string;
  /** Every evaluated check, for the run record. */
  checks: PreflightCheck[];
}

/** First non-proceed check wins; otherwise proceed. */
export function decideTransition(checks: PreflightCheck[]): Decision {
  for (const check of checks) {
    if (check.verdict.kind !== 'proceed') {
      return { verdict: check.verdict, decidedBy: check.name, checks };
    }
  }
  return { verdict: { kind: 'proceed' }, decidedBy: 'all-pass', checks };
}

/**
 * The standard state-machine checks every loop runs first:
 * edge legality, state match, target-already-reached idempotency,
 * operational holds, and live-claim short-circuit.
 */
export function standardChecks(
  loop: LoopDefinition,
  table: TransitionTable,
  item: IssueSnapshot,
  now: Date,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const { from, to } = loop.transition;

  const edge = validateLoopTransition(table, { from, to }, { dispatches: loop.expects != null });
  checks.push({
    name: 'edge-legal',
    verdict: edge.legal
      ? { kind: 'proceed' }
      : { kind: 'escalate', reason: edge.reason ?? 'illegal edge' },
  });

  const state = stateOfLabels(item.labels);
  if (item.labels.includes(stateLabel(to)) || state === to) {
    checks.push({
      name: 'already-advanced',
      verdict: { kind: 'no-op', reason: `item already in '${to}'` },
    });
  } else {
    checks.push({ name: 'already-advanced', verdict: { kind: 'proceed' } });
  }

  checks.push({
    name: 'state-match',
    verdict:
      state === from
        ? { kind: 'proceed' }
        : { kind: 'skip', reason: `item state is '${state ?? 'unmanaged'}', loop needs '${from}'` },
  });

  const holds = item.labels.filter((l) => {
    if (l === 'looper:needs-approval') {
      // The approval hold is released by a trusted `looper:approved` (M17).
      return !item.labels.includes('looper:approved');
    }
    return ['looper:stop', 'looper:parked', 'looper:quarantine'].includes(l);
  });
  checks.push({
    name: 'operational-holds',
    verdict:
      holds.length === 0
        ? { kind: 'proceed' }
        : { kind: 'skip', reason: `operational hold present: ${holds.join(', ')}` },
  });

  const offRamps = item.labels.filter((l) =>
    ['looper:blocked', 'looper:needs-human', 'looper:stuck', 'looper:abandoned'].includes(l),
  );
  checks.push({
    name: 'off-ramps',
    verdict:
      offRamps.length === 0
        ? { kind: 'proceed' }
        : { kind: 'skip', reason: `off-ramp present: ${offRamps.join(', ')}` },
  });

  const claims = parseClaims(item.labels);
  const lease = parseLeaseExpiry(item.labels);
  const claimLive = claims.length > 0 && !isLeaseExpired(lease, now);
  checks.push({
    name: 'claim-in-flight',
    verdict: claimLive
      ? { kind: 'skip', reason: `claimed by ${claims[0]} (lease live until ${lease})` }
      : { kind: 'proceed' },
  });

  return checks;
}
