/**
 * The canonical V1 event/action matrix (task 0008) — the single source of
 * truth for: config validation (0006), event normalization (`@looper/github`),
 * trigger-source filtering (0081), custom-loop authoring (0078), and fake
 * GitHub event emission (0083). Workflow `types:` are pinned to this; unknown
 * events/actions are ignored fail-closed.
 */
export const EVENT_ACTION_MATRIX: Readonly<Record<string, readonly string[]>> = {
  issues: ['opened', 'edited', 'reopened', 'labeled', 'unlabeled'],
  issue_comment: ['created', 'edited'],
  pull_request: [
    'opened',
    'reopened',
    'synchronize',
    'ready_for_review',
    'converted_to_draft',
    'labeled',
    'unlabeled',
    'closed',
  ],
  pull_request_review: ['submitted', 'edited', 'dismissed'],
  check_run: ['completed', 'rerequested'],
  check_suite: ['completed'],
  /** `status` has no actions; honored states are success/failure/error/pending. */
  status: [],
  workflow_run: ['completed'],
  /** Repository label DEFINITIONS only — never item labeling (that's issues.labeled). */
  label: ['created', 'edited', 'deleted'],
};

export type SupportedEventName = keyof typeof EVENT_ACTION_MATRIX & string;

export function isSupportedEvent(event: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_ACTION_MATRIX, event);
}

/** Is `event` (+ optional action) inside the pinned matrix? */
export function isSupportedEventAction(event: string, action?: string): boolean {
  const actions = EVENT_ACTION_MATRIX[event];
  if (!actions) return false;
  if (action === undefined) return true;
  if (actions.length === 0) return false; // action given for an action-less event
  return actions.includes(action);
}

/**
 * `merge` is a normalized predicate, not a GitHub event: it is
 * `pull_request.closed` with payload `merged == true` (0008 decision).
 */
export const MERGE_SOURCE = {
  event: 'pull_request',
  action: 'closed',
  predicate: 'merged',
} as const;
