/** Shared identifiers used across the port interfaces. Pure types — no IO. */

export interface RepoRef {
  owner: string;
  repo: string;
}

/** An issue or pull request — the unit of work the state machine drives. */
export interface ItemRef extends RepoRef {
  number: number;
}

/**
 * The clock seam (task 0086). The runtime never blocks (no sleep), so a clock
 * is just an injectable "what time is it now" — threaded everywhere wall time
 * is read (runner, sweep, lease expiry, backoff, telemetry) as the optional
 * `now` dep. A `VirtualClock` (in `@loopdog/testing`) conforms to this so the
 * simulation owns all time advancement; production passes the default below.
 */
export type Clock = () => Date;

/** The default wall-clock used when no clock is injected. */
export const systemClock: Clock = () => new Date();

export type ItemKind = 'issue' | 'pull-request';

/** GitHub's author_association values, used by the authorization gate (M17). */
export type AuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'MANNEQUIN'
  | 'NONE';

export interface ActorRef {
  login: string;
  /** 'Bot' for GitHub Apps / [bot] accounts, 'User' otherwise. */
  type: 'User' | 'Bot';
}

export interface LabelSpec {
  name: string;
  color?: string | undefined;
  description?: string | undefined;
}

export interface IssueSnapshot {
  ref: ItemRef;
  kind: ItemKind;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  author: ActorRef;
  authorAssociation: AuthorAssociation;
  createdAt: string;
  updatedAt: string;
}

export interface CommentSnapshot {
  id: number;
  body: string;
  author: ActorRef;
  authorAssociation: AuthorAssociation;
  createdAt: string;
}

export interface PullRequestSnapshot extends IssueSnapshot {
  headRef: string;
  baseRef: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required';

export interface CheckRunSnapshot {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: CheckConclusion | null;
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface ReviewSnapshot {
  author: ActorRef;
  state: ReviewState;
  submittedAt: string;
  body: string;
}

/** A normalized trigger the runtime reacts to: a GitHub event or a cron tick. */
export type TriggerEvent =
  | {
      kind: 'event';
      /** e.g. 'issues.labeled', 'issue_comment.created', 'pull_request.opened' */
      name: string;
      item?: ItemRef | undefined;
      actor?: ActorRef | undefined;
      authorAssociation?: AuthorAssociation | undefined;
      /** Item label applied/removed, when the event carries one. */
      label?: string | undefined;
      /** For pull_request.closed: whether the PR merged (the merge predicate). */
      merged?: boolean | undefined;
      deliveredAt: string;
    }
  | {
      kind: 'cron';
      /** Cron is the trusted "system" actor (M17). */
      deliveredAt: string;
    };
