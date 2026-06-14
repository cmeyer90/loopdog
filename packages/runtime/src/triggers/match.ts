import type { IssueSnapshot, LoopDefinition, TriggerEvent } from '@loopdog/core';

/**
 * Event → loop matching (task 0008): which declared loops does a normalized
 * GitHub event drive? Fail-closed: unknown events match nothing; predicates
 * and filters must hold. (Cron loops are the sweep's job, never matched here.)
 */
export function matchLoopsForEvent(
  loops: readonly LoopDefinition[],
  trigger: TriggerEvent,
  item?: IssueSnapshot,
): LoopDefinition[] {
  if (trigger.kind !== 'event') return [];
  return loops.filter((loop) => {
    if (loop.trigger.kind !== 'github_event') return false;
    const t = loop.trigger;

    const eventBase = trigger.name.split('.')[0]!;
    const nameMatches = t.events.some((e) => e === trigger.name || e === eventBase);
    if (!nameMatches) return false;

    // Predicates — e.g. { merged: true } on pull_request.closed (the merge source).
    if (t.predicate) {
      for (const [key, want] of Object.entries(t.predicate)) {
        if (key === 'merged' && trigger.merged !== want) return false;
      }
    }

    // Filters — author / label.
    if (t.filter?.label !== undefined) {
      const labelMatches =
        trigger.label === t.filter.label || (item?.labels.includes(t.filter.label) ?? false);
      if (!labelMatches) return false;
    }
    if (t.filter?.author !== undefined) {
      const author = item?.author.login ?? trigger.actor?.login;
      if (author !== t.filter.author) return false;
    }
    return true;
  });
}
