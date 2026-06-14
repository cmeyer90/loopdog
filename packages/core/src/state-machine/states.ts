/**
 * Label namespace + default state set (task 0011). Labels ARE the state
 * machine; everything loopdog writes lives under the `loopdog:` namespace so it
 * never collides with the adopter's own labels.
 */

export const STATE_LABEL_PREFIX = 'loopdog:state/';

/** Default lifecycle states. */
export const DEFAULT_STATES = [
  'new',
  'needs-grooming',
  'needs-clarification',
  'ready-for-agent',
  'in-progress',
  'in-review',
  'changes-requested',
  'verified',
  'merged',
  'deployed',
  /** Optional entry state for cron-triggered loops. */
  'scheduled',
] as const;

/** Deploy extension states shipped by the built-in deploy loop (M11). */
export const DEPLOY_STATES = ['deploying', 'deploy-failed', 'rolled-back'] as const;

/** Terminal/holding off-ramps — any state may route here (always legal). */
export const OFF_RAMP_LABELS = [
  'loopdog:blocked',
  'loopdog:needs-human',
  'loopdog:stuck',
  'loopdog:abandoned',
] as const;

/** Operational labels (holds/marks that never replace the lifecycle state). */
export const OPERATIONAL_LABELS = [
  /** Kill switch (M12 · 0050): present on repo item or used as repo-wide marker. */
  'loopdog:stop',
  /** Authorization hold + release (M17 · 0080). */
  'loopdog:needs-approval',
  'loopdog:approved',
  /** Budget/quota/kill-switch hold that preserves the lifecycle state (M12). */
  'loopdog:parked',
  /** Exhausted-failure hold (M19 · 0091). */
  'loopdog:quarantine',
] as const;

/** Claim/lease/lock marker prefixes (task 0013). */
export const CLAIM_LABEL_PREFIX = 'loopdog:claimed-by/';
export const LEASE_LABEL_PREFIX = 'loopdog:lease/';
export const LOCK_LABEL_PREFIX = 'loopdog:lock/';

/** Quarantine hold for a poisoned item (M19 · 0091). */
export const QUARANTINE_LABEL = 'loopdog:quarantine';

/** Circuit-breaker pause, per loop (M19 · 0090): `loopdog:paused/<loop>`. */
export const PAUSED_LABEL_PREFIX = 'loopdog:paused/';

export function pausedLabel(loop: string): string {
  return `${PAUSED_LABEL_PREFIX}${loop}`;
}

export function stateLabel(state: string): string {
  return `${STATE_LABEL_PREFIX}${state}`;
}

/** The state encoded on an item's labels, or null when unmanaged. */
export function stateOfLabels(labels: readonly string[]): string | null {
  const states = labels
    .filter((l) => l.startsWith(STATE_LABEL_PREFIX))
    .map((l) => l.slice(STATE_LABEL_PREFIX.length));
  return states[0] ?? null;
}

export function isOffRamp(label: string): boolean {
  return (OFF_RAMP_LABELS as readonly string[]).includes(label);
}

/** Off-ramp targets accepted as a transition `to` (the `loopdog:` prefix stripped). */
export const OFF_RAMP_STATES = OFF_RAMP_LABELS.map((l) => l.slice('loopdog:'.length));
