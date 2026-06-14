import type { GitHubPort, ItemRef } from '@loopdog/core';

/** Attempt counter as a label (`loopdog:attempts/N`) — sweep-visible state for
 * stuck detection (M12 · 0051) without a side datastore. */

const PREFIX = 'loopdog:attempts/';

export function parseAttempts(labels: readonly string[]): number {
  const label = labels.find((l) => l.startsWith(PREFIX));
  if (!label) return 0;
  const n = Number.parseInt(label.slice(PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function bumpAttempts(gh: GitHubPort, item: ItemRef): Promise<number> {
  const labels = await gh.getItemLabels(item);
  const current = parseAttempts(labels);
  const next = current + 1;
  await gh.addLabels(item, [`${PREFIX}${next}`]);
  const old = labels.find((l) => l.startsWith(PREFIX));
  if (old) await gh.removeLabel(item, old);
  return next;
}

export async function clearAttempts(gh: GitHubPort, item: ItemRef): Promise<void> {
  const labels = await gh.getItemLabels(item);
  for (const label of labels) {
    if (label.startsWith(PREFIX)) await gh.removeLabel(item, label);
  }
}

/**
 * Dispatch deadline (M19 · 0089): a runtime-stamped `not correlated by` instant,
 * label-encoded so the sweep can detect a work cell that never produced a PR
 * (0073) and escalate it as a timed-out (transient) attempt rather than leave it
 * stranded. Stamped by the RUNTIME at dispatch (`deps.now` + dispatch_timeout) —
 * independent of the backend's own `dispatchedAt`.
 */
const DEADLINE_PREFIX = 'loopdog:dispatch-deadline/';

export function dispatchDeadlineLabel(until: string): string {
  return `${DEADLINE_PREFIX}${until}`;
}

export function parseDispatchDeadline(labels: readonly string[]): string | null {
  const label = labels.find((l) => l.startsWith(DEADLINE_PREFIX));
  return label ? label.slice(DEADLINE_PREFIX.length) : null;
}

export async function clearDispatchDeadline(gh: GitHubPort, item: ItemRef): Promise<void> {
  const labels = await gh.getItemLabels(item);
  for (const label of labels) {
    if (label.startsWith(DEADLINE_PREFIX)) await gh.removeLabel(item, label);
  }
}
