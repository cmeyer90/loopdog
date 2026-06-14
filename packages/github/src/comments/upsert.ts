import type { GitHubPort, ItemRef } from '@loopdog/core';

/**
 * Idempotent marked-comment upsert: exactly one comment per marker, updated in
 * place — so sweeps re-running never spam (used by `suggest` advisories, 0009,
 * and other sticky status comments).
 */
export async function upsertMarkedComment(
  gh: GitHubPort,
  ref: ItemRef,
  marker: string,
  body: string,
): Promise<{ id: number; created: boolean }> {
  const full = `${body}\n\n<!-- ${marker} -->`;
  const existing = (await gh.listComments(ref)).find((c) => c.body.includes(`<!-- ${marker} -->`));
  if (existing) {
    if (existing.body !== full) {
      await gh.updateComment(ref, existing.id, full);
    }
    return { id: existing.id, created: false };
  }
  const { id } = await gh.createComment(ref, full);
  return { id, created: true };
}
