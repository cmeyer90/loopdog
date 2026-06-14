import type { GitHubPort, ItemRef } from '@loopdog/core';
import {
  DEFAULT_LEASE_TTL_MINUTES,
  claimLabel,
  claimMarker,
  isLeaseExpired,
  leaseExpiry,
  leaseLabel,
  lockLabel,
  parseClaims,
  parseLeaseExpiry,
  resolveClaimRace,
} from '@loopdog/core';

/**
 * Atomic claiming over GitHub labels (task 0013). GitHub has no transactions,
 * so this is optimistic concurrency: add the claim marker, RE-READ, resolve
 * the race deterministically (lowest marker wins), and only the winner stamps
 * the lease. A claim without a lease reads as expired (crash self-heal).
 * Port-generic: works against the real Octokit adapter and the test fake.
 */

export interface ClaimOptions {
  now?: Date;
  ttlMinutes?: number;
  /** Bot login to assign (the visible "someone is on it" signal). */
  assignee?: string;
  /** Advisory serialization area (loop `serialize_by`), if any. */
  serializeArea?: string;
  /**
   * Invocation-unique claimant token. REQUIRED for a correct CAS when two
   * invocations can derive the same deterministic run id (event racing the
   * sweep): identical claim labels merge into one and both racers would
   * "win". Defaults to the run id (single-invocation callers).
   */
  claimant?: string;
}

export type ClaimResult =
  | { acquired: true; runId: string; leaseUntil: string }
  | { acquired: false; reason: string };

export async function acquireClaim(
  gh: GitHubPort,
  item: ItemRef,
  runId: string,
  opts: ClaimOptions = {},
): Promise<ClaimResult> {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlMinutes ?? DEFAULT_LEASE_TTL_MINUTES;

  // Pre-check: a live claim already present → don't even contend.
  const before = await gh.getItemLabels(item);
  const existing = parseClaims(before);
  if (existing.length > 0 && !isLeaseExpired(parseLeaseExpiry(before), now)) {
    return { acquired: false, reason: `already claimed by ${existing[0]}` };
  }

  // Per-area serialization: defer when any OTHER live item holds the area lock.
  if (opts.serializeArea) {
    const lock = lockLabel(opts.serializeArea);
    const holders = await gh.listIssuesByLabel({ owner: item.owner, repo: item.repo }, lock);
    const liveHolder = holders.find(
      (h) => h.ref.number !== item.number && !isLeaseExpired(parseLeaseExpiry(h.labels), now),
    );
    if (liveHolder) {
      return {
        acquired: false,
        reason: `area '${opts.serializeArea}' locked by #${liveHolder.ref.number}`,
      };
    }
  }

  // CAS attempt: claim marker (+ assignment), then re-read and resolve.
  const claimant = opts.claimant ?? runId;
  const marker = claimMarker(claimant);
  await gh.addLabels(item, [claimLabel(claimant)]);
  // The assignee is a cosmetic "someone is on it" signal — the claim LABEL is
  // the real lock. Assigning a bot/agent fails under an Actions installation
  // token ("Assigning agents is not supported…"), so never let it abort the
  // claim and strand the item between marker and lease.
  if (opts.assignee) {
    await tryAssign(() => gh.addAssignees(item, [opts.assignee!]));
  }

  const after = await gh.getItemLabels(item);
  const winner = resolveClaimRace(parseClaims(after));
  if (winner !== marker) {
    await gh.removeLabel(item, claimLabel(claimant)); // lose cleanly
    return { acquired: false, reason: `lost claim race to ${winner}` };
  }

  // Winner stamps the lease (and the area lock).
  const until = leaseExpiry(now, ttl);
  const stamps = [leaseLabel(until)];
  if (opts.serializeArea) stamps.push(lockLabel(opts.serializeArea));
  await gh.addLabels(item, stamps);
  return { acquired: true, runId, leaseUntil: until };
}

/** Extend a live claim's lease (long-running provider work renews on progress). */
export async function renewLease(
  gh: GitHubPort,
  item: ItemRef,
  opts: { now?: Date; ttlMinutes?: number } = {},
): Promise<string> {
  const now = opts.now ?? new Date();
  const labels = await gh.getItemLabels(item);
  const old = labels.find((l) => l.startsWith('loopdog:lease/'));
  const until = leaseExpiry(now, opts.ttlMinutes ?? DEFAULT_LEASE_TTL_MINUTES);
  await gh.addLabels(item, [leaseLabel(until)]);
  if (old) await gh.removeLabel(item, old);
  return until;
}

/** Release every claim/lease/lock marker (terminal outcome or loser cleanup). */
export async function releaseClaim(
  gh: GitHubPort,
  item: ItemRef,
  opts: { assignee?: string } = {},
): Promise<void> {
  const labels = await gh.getItemLabels(item);
  for (const label of labels) {
    if (
      label.startsWith('loopdog:claimed-by/') ||
      label.startsWith('loopdog:lease/') ||
      label.startsWith('loopdog:lock/')
    ) {
      await gh.removeLabel(item, label);
    }
  }
  if (opts.assignee) {
    await tryAssign(() => gh.removeAssignees(item, [opts.assignee!]));
  }
}

/**
 * Run a best-effort (un)assignment. Assignment of bot/agent identities is not
 * permitted under an Actions installation token; the claim's correctness rests
 * on the label CAS, not the assignee, so a failure here is swallowed.
 */
async function tryAssign(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // cosmetic signal only — ignore (e.g. installation token can't assign agents)
  }
}

/**
 * Sweep helper: clear expired claim/lease/lock markers from one item so it
 * becomes claimable again (crashed/timed-out run recovery).
 */
export async function clearExpiredClaim(
  gh: GitHubPort,
  item: ItemRef,
  now: Date = new Date(),
): Promise<boolean> {
  const labels = await gh.getItemLabels(item);
  const claims = parseClaims(labels);
  if (claims.length === 0) return false;
  if (!isLeaseExpired(parseLeaseExpiry(labels), now)) return false;
  await releaseClaim(gh, item);
  return true;
}
