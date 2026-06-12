import type { AuthorAssociation, TriggerEvent } from '@looper/core';

/**
 * Normalize a GitHub Actions event into a `TriggerEvent` (task 0008 input).
 * Input is the workflow's event name + the webhook payload (the file at
 * `GITHUB_EVENT_PATH`). Unknown events normalize with item/actor when present,
 * so custom loops can subscribe to events looper doesn't special-case.
 */
export function parseActionsEvent(
  eventName: string,
  payload: Record<string, unknown>,
  repo: { owner: string; repo: string },
  deliveredAt: string,
): TriggerEvent {
  if (eventName === 'schedule') {
    return { kind: 'cron', deliveredAt };
  }

  const action = typeof payload['action'] === 'string' ? (payload['action'] as string) : undefined;
  const name = action ? `${eventName}.${action}` : eventName;

  const itemNumber = pickNumber(payload);
  const sender = payload['sender'] as { login?: string; type?: string } | undefined;
  const association = pickAssociation(payload);
  const label = (payload['label'] as { name?: string } | undefined)?.name;
  const pr = payload['pull_request'] as { merged?: boolean } | undefined;

  return {
    kind: 'event',
    name,
    item: itemNumber === null ? undefined : { ...repo, number: itemNumber },
    actor: sender?.login
      ? { login: sender.login, type: sender.type === 'Bot' ? 'Bot' : 'User' }
      : undefined,
    authorAssociation: association,
    label,
    merged: typeof pr?.merged === 'boolean' ? pr.merged : undefined,
    deliveredAt,
  };
}

/** The events the built-in loops subscribe to (0008's matrix). */
export const SUPPORTED_EVENTS = [
  'issues.opened',
  'issues.edited',
  'issues.labeled',
  'issue_comment.created',
  'issue_comment.edited',
  'pull_request.opened',
  'pull_request.synchronize',
  'pull_request.closed',
  'pull_request.labeled',
  'pull_request_review.submitted',
  'check_suite.completed',
  'workflow_run.completed',
  'status',
  'schedule',
] as const;

function pickNumber(payload: Record<string, unknown>): number | null {
  const issue = payload['issue'] as { number?: number } | undefined;
  if (typeof issue?.number === 'number') return issue.number;
  const pr = payload['pull_request'] as { number?: number } | undefined;
  if (typeof pr?.number === 'number') return pr.number;
  // check_suite / workflow_run events: take the first associated PR if any
  const cs = payload['check_suite'] as { pull_requests?: Array<{ number?: number }> } | undefined;
  if (typeof cs?.pull_requests?.[0]?.number === 'number') return cs.pull_requests[0].number;
  const wr = payload['workflow_run'] as { pull_requests?: Array<{ number?: number }> } | undefined;
  if (typeof wr?.pull_requests?.[0]?.number === 'number') return wr.pull_requests[0].number;
  return null;
}

function pickAssociation(payload: Record<string, unknown>): AuthorAssociation | undefined {
  for (const key of ['comment', 'issue', 'pull_request', 'review']) {
    const obj = payload[key] as { author_association?: string } | undefined;
    if (typeof obj?.author_association === 'string') {
      return obj.author_association as AuthorAssociation;
    }
  }
  return undefined;
}
