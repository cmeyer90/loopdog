import {
  CLAIM_LABEL_PREFIX,
  LEASE_LABEL_PREFIX,
  LOCK_LABEL_PREFIX,
} from '../state-machine/states.js';

/**
 * Pure claim-protocol logic (task 0013). GitHub has no transactions, so the
 * claim is label-based optimistic concurrency: add `looper:claimed-by/<run>`
 * + assign the bot, then RE-READ; if more than one claim marker is present
 * (lost race), the lexicographically lowest run id wins and losers release.
 * The IO wrapper lives in `@looper/github` (claims/).
 */

/**
 * GitHub label names cap at 50 chars; the marker compacts long run ids
 * deterministically so the claim label always fits. Both racers compute
 * markers the same way, so marker comparison stays a valid tie-break.
 */
export function claimMarker(runId: string): string {
  const max = 50 - CLAIM_LABEL_PREFIX.length;
  if (runId.length <= max) return runId;
  return `${runId.slice(0, max - 9)}~${fnv8(runId)}`;
}

export function claimLabel(runId: string): string {
  return `${CLAIM_LABEL_PREFIX}${claimMarker(runId)}`;
}

/** Lease labels carry the expiry instant verbatim (labels permit ':' and '.'). */
export function leaseLabel(expiresAt: string): string {
  return `${LEASE_LABEL_PREFIX}${expiresAt}`;
}

export function lockLabel(area: string): string {
  return `${LOCK_LABEL_PREFIX}${area}`;
}

export function parseClaims(labels: readonly string[]): string[] {
  return labels
    .filter((l) => l.startsWith(CLAIM_LABEL_PREFIX))
    .map((l) => l.slice(CLAIM_LABEL_PREFIX.length))
    .sort();
}

export function parseLeaseExpiry(labels: readonly string[]): string | null {
  const lease = labels.find((l) => l.startsWith(LEASE_LABEL_PREFIX));
  if (!lease) return null;
  return lease.slice(LEASE_LABEL_PREFIX.length);
}

export function parseLocks(labels: readonly string[]): string[] {
  return labels
    .filter((l) => l.startsWith(LOCK_LABEL_PREFIX))
    .map((l) => l.slice(LOCK_LABEL_PREFIX.length));
}

/**
 * Race resolution after the re-read: the lowest run id wins (deterministic on
 * both sides, no coordination needed). Returns the winner.
 */
export function resolveClaimRace(claimRunIds: readonly string[]): string | null {
  if (claimRunIds.length === 0) return null;
  return [...claimRunIds].sort()[0] ?? null;
}

export function isLeaseExpired(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return true; // claim without a lease is malformed → reclaimable
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true; // unparseable lease → fail open to recovery
  return t <= now.getTime();
}

export function leaseExpiry(now: Date, ttlMinutes: number): string {
  return new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
}

/** Default lease TTL (minutes) — conservative; sweeps reclaim after this. */
export const DEFAULT_LEASE_TTL_MINUTES = 30;

/** Tiny deterministic hash (FNV-1a, 32-bit) for marker compaction. */
function fnv8(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
