import type {
  ActorRef,
  CheckRunSnapshot,
  CommentSnapshot,
  IssueSnapshot,
  ItemRef,
  LabelSpec,
  PullRequestSnapshot,
  ReviewSnapshot,
} from './types.js';

/**
 * The GitHub port (task 0094): every read/write loopdog performs against GitHub
 * goes through this interface. Implemented by `@loopdog/github` (Octokit over
 * `GITHUB_TOKEN`) and by `@loopdog/testing`'s in-memory fake (0083).
 *
 * Composed from small capability interfaces so fakes and partial consumers can
 * implement exactly what they use.
 */
export interface GitHubPort
  extends
    IssuesPort,
    LabelsPort,
    PullsPort,
    ChecksPort,
    RepoFilesPort,
    IdentityPort,
    WorkflowsPort {}

export interface IssuesPort {
  getIssue(ref: ItemRef): Promise<IssueSnapshot>;
  /** Open issues carrying the given label. */
  listIssuesByLabel(repo: { owner: string; repo: string }, label: string): Promise<IssueSnapshot[]>;
  updateIssueBody(ref: ItemRef, body: string): Promise<void>;
  createIssue(
    repo: { owner: string; repo: string },
    draft: { title: string; body: string; labels?: string[] },
  ): Promise<ItemRef>;
  listComments(ref: ItemRef): Promise<CommentSnapshot[]>;
  createComment(ref: ItemRef, body: string): Promise<{ id: number }>;
  updateComment(ref: ItemRef, commentId: number, body: string): Promise<void>;
  addAssignees(ref: ItemRef, logins: string[]): Promise<void>;
  removeAssignees(ref: ItemRef, logins: string[]): Promise<void>;
}

export interface LabelsPort {
  /** Labels defined on the repository (not on an item). */
  listRepoLabels(repo: { owner: string; repo: string }): Promise<LabelSpec[]>;
  createRepoLabel(repo: { owner: string; repo: string }, label: LabelSpec): Promise<void>;
  /** Labels currently on an item (fresh read — used by the claim re-read). */
  getItemLabels(ref: ItemRef): Promise<string[]>;
  addLabels(ref: ItemRef, labels: string[]): Promise<void>;
  /** Removing an absent label must resolve (idempotent), not throw. */
  removeLabel(ref: ItemRef, label: string): Promise<void>;
}

export interface PullsPort {
  getPullRequest(ref: ItemRef): Promise<PullRequestSnapshot>;
  /** All PRs (open unless stated) whose head branch starts with the prefix — correlation (0073). */
  listPullRequestsByHeadPrefix(
    repo: { owner: string; repo: string },
    prefix: string,
    opts?: { state?: 'open' | 'closed' | 'all' },
  ): Promise<PullRequestSnapshot[]>;
  listPullRequestFiles(ref: ItemRef): Promise<string[]>;
  listReviews(ref: ItemRef): Promise<ReviewSnapshot[]>;
  mergePullRequest(
    ref: ItemRef,
    opts: { method: 'merge' | 'squash' | 'rebase'; expectedHeadSha?: string },
  ): Promise<{ merged: boolean; sha?: string | undefined }>;
  requestReviewers(ref: ItemRef, logins: string[]): Promise<void>;
}

export interface ChecksPort {
  /** Check runs for a git ref (branch or sha) — ladder rung 2 reads (0014/0041). */
  listCheckRuns(repo: { owner: string; repo: string }, gitRef: string): Promise<CheckRunSnapshot[]>;
}

/**
 * Repo file IO over the contents API. Used by the plan store (M04, default
 * branch) and the run-record store (0053, orphan `loopdog/telemetry` branch).
 */
export interface RepoFilesPort {
  /** Ensure a branch exists; `orphan: true` creates it with an empty root commit. */
  ensureBranch(
    repo: { owner: string; repo: string },
    branch: string,
    opts?: { orphan?: boolean },
  ): Promise<void>;
  /** null when the file does not exist on the branch. */
  readFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
  ): Promise<{ content: string; sha: string } | null>;
  /**
   * Create or update a file. `expectedSha` is the optimistic-concurrency guard:
   * pass the sha from `readFile` when updating; omit when creating. Implementations
   * must reject on sha mismatch (lost race) so callers can re-read and retry.
   */
  writeFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
    content: string,
    message: string,
    expectedSha?: string,
  ): Promise<{ sha: string }>;
  listDir(repo: { owner: string; repo: string }, branch: string, path: string): Promise<string[]>;
}

/**
 * A GitHub Actions workflow's lifecycle state. `active` runs on its triggers;
 * the `disabled_*` states do not — `disabled_manually` (a human/`gh` turned it
 * off), `disabled_inactivity` (GitHub auto-disables a *scheduled* workflow after
 * 60 days of repo inactivity), `disabled_fork` (workflows don't run on forks).
 */
export type WorkflowRunState =
  | 'active'
  | 'deleted'
  | 'disabled_fork'
  | 'disabled_inactivity'
  | 'disabled_manually';

export interface WorkflowSummary {
  /** Numeric workflow id (stable; the unambiguous handle for enable/disable). */
  id: number;
  /** Display name from the workflow's `name:` field. */
  name: string;
  /** Repo-relative path, e.g. `.github/workflows/loopdog-events.yml`. */
  path: string;
  state: WorkflowRunState;
}

/**
 * Manage GitHub Actions workflow run-state (task 0099). Operator surface: the
 * controller drives work because `loopdog-events`/`loopdog-sweep` fire it, so a
 * disabled workflow silently stalls the pipeline. Enable/disable need a token
 * with `actions:write` (the operator's `gh` auth), never the runtime token.
 */
export interface WorkflowsPort {
  /** Every workflow registered on the repo (active + disabled). */
  listWorkflows(repo: { owner: string; repo: string }): Promise<WorkflowSummary[]>;
  /** Enable a workflow by numeric id or filename (e.g. `loopdog-events.yml`). Idempotent. */
  enableWorkflow(repo: { owner: string; repo: string }, workflow: string | number): Promise<void>;
  /** Disable a workflow by numeric id or filename. Idempotent. */
  disableWorkflow(repo: { owner: string; repo: string }, workflow: string | number): Promise<void>;
}

export interface IdentityPort {
  /** Who the controller is acting as (e.g. 'github-actions[bot]'). */
  getAuthenticatedActor(): Promise<ActorRef>;
  /** Trigger a workflow_dispatch (the self-hosted worker, 0074). */
  dispatchWorkflow(
    repo: { owner: string; repo: string },
    workflowFile: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void>;
  getRepoMeta(repo: { owner: string; repo: string }): Promise<{
    defaultBranch: string;
    visibility: 'public' | 'private' | 'internal';
  }>;
}
