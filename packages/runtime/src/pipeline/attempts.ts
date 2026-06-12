import type { GitHubPort, ItemRef } from '@looper/core';

/** Attempt counter as a label (`looper:attempts/N`) — sweep-visible state for
 * stuck detection (M12 · 0051) without a side datastore. */

const PREFIX = 'looper:attempts/';

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
