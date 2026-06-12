import { Octokit } from '@octokit/rest';
import type {
  ActorRef,
  CheckRunSnapshot,
  CommentSnapshot,
  GitHubPort,
  IssueSnapshot,
  ItemRef,
  LabelSpec,
  PullRequestSnapshot,
  ReviewSnapshot,
} from '@looper/core';
import { ACTIONS_BOT } from '../identity/identity.js';

/** The git empty-tree object — lets us create a parentless (orphan) commit. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The production `GitHubPort` (task 0094): a thin Octokit wrapper over the
 * Actions `GITHUB_TOKEN` (or any token). All looper GitHub IO flows through
 * here; behavior matches the `@looper/testing` fake (component conformance).
 */
export class OctokitGitHub implements GitHubPort {
  private readonly octokit: Octokit;

  constructor(opts: { token: string; baseUrl?: string }) {
    this.octokit = new Octokit({
      auth: opts.token,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    });
  }

  // ---- IssuesPort ----

  async getIssue(ref: ItemRef): Promise<IssueSnapshot> {
    const { data } = await this.octokit.rest.issues.get({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
    });
    return mapIssue(ref, data);
  }

  async listIssuesByLabel(
    repo: { owner: string; repo: string },
    label: string,
  ): Promise<IssueSnapshot[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      ...repo,
      labels: label,
      state: 'open',
      per_page: 100,
    });
    return rows.map((data) => mapIssue({ ...repo, number: data.number }, data));
  }

  async updateIssueBody(ref: ItemRef, body: string): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      body,
    });
  }

  async createIssue(
    repo: { owner: string; repo: string },
    draft: { title: string; body: string; labels?: string[] },
  ): Promise<ItemRef> {
    const { data } = await this.octokit.rest.issues.create({
      ...repo,
      title: draft.title,
      body: draft.body,
      ...(draft.labels ? { labels: draft.labels } : {}),
    });
    return { ...repo, number: data.number };
  }

  async listComments(ref: ItemRef): Promise<CommentSnapshot[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.issues.listComments, {
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      per_page: 100,
    });
    return rows.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      author: mapActor(c.user),
      authorAssociation: (c.author_association ?? 'NONE') as CommentSnapshot['authorAssociation'],
      createdAt: c.created_at,
    }));
  }

  async createComment(ref: ItemRef, body: string): Promise<{ id: number }> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      body,
    });
    return { id: data.id };
  }

  async updateComment(ref: ItemRef, commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({
      owner: ref.owner,
      repo: ref.repo,
      comment_id: commentId,
      body,
    });
  }

  async addAssignees(ref: ItemRef, logins: string[]): Promise<void> {
    await this.octokit.rest.issues.addAssignees({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      assignees: logins,
    });
  }

  async removeAssignees(ref: ItemRef, logins: string[]): Promise<void> {
    await this.octokit.rest.issues.removeAssignees({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      assignees: logins,
    });
  }

  // ---- LabelsPort ----

  async listRepoLabels(repo: { owner: string; repo: string }): Promise<LabelSpec[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      ...repo,
      per_page: 100,
    });
    return rows.map((l) => ({
      name: l.name,
      color: l.color ?? undefined,
      description: l.description ?? undefined,
    }));
  }

  async createRepoLabel(repo: { owner: string; repo: string }, label: LabelSpec): Promise<void> {
    await this.octokit.rest.issues.createLabel({
      ...repo,
      name: label.name,
      ...(label.color ? { color: label.color } : {}),
      ...(label.description ? { description: label.description } : {}),
    });
  }

  async getItemLabels(ref: ItemRef): Promise<string[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.issues.listLabelsOnIssue, {
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      per_page: 100,
    });
    return rows.map((l) => l.name);
  }

  async addLabels(ref: ItemRef, labels: string[]): Promise<void> {
    await this.octokit.rest.issues.addLabels({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      labels,
    });
  }

  async removeLabel(ref: ItemRef, label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        name: label,
      });
    } catch (err) {
      if (isStatus(err, 404)) return; // absent already — idempotent by contract
      throw err;
    }
  }

  // ---- PullsPort ----

  async getPullRequest(ref: ItemRef): Promise<PullRequestSnapshot> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    return mapPull(ref, data);
  }

  async listPullRequestsByHeadPrefix(
    repo: { owner: string; repo: string },
    prefix: string,
    opts?: { state?: 'open' | 'closed' | 'all' },
  ): Promise<PullRequestSnapshot[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.pulls.list, {
      ...repo,
      state: opts?.state ?? 'open',
      per_page: 100,
    });
    return rows
      .filter((pr) => pr.head.ref.startsWith(prefix))
      .map((pr) => mapPull({ ...repo, number: pr.number }, pr));
  }

  async listPullRequestFiles(ref: ItemRef): Promise<string[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    });
    return rows.map((f) => f.filename);
  }

  async listReviews(ref: ItemRef): Promise<ReviewSnapshot[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.pulls.listReviews, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    });
    return rows.map((r) => ({
      author: mapActor(r.user),
      state: (r.state ?? 'PENDING') as ReviewSnapshot['state'],
      submittedAt: r.submitted_at ?? '',
      body: r.body ?? '',
    }));
  }

  async mergePullRequest(
    ref: ItemRef,
    opts: { method: 'merge' | 'squash' | 'rebase'; expectedHeadSha?: string },
  ): Promise<{ merged: boolean; sha?: string | undefined }> {
    try {
      const { data } = await this.octokit.rest.pulls.merge({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        merge_method: opts.method,
        ...(opts.expectedHeadSha ? { sha: opts.expectedHeadSha } : {}),
      });
      return { merged: data.merged, sha: data.sha ?? undefined };
    } catch (err) {
      // 405 = not mergeable (checks/reviews), 409 = head moved past expectedHeadSha
      if (isStatus(err, 405) || isStatus(err, 409)) return { merged: false };
      throw err;
    }
  }

  async requestReviewers(ref: ItemRef, logins: string[]): Promise<void> {
    await this.octokit.rest.pulls.requestReviewers({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      reviewers: logins,
    });
  }

  // ---- ChecksPort ----

  async listCheckRuns(
    repo: { owner: string; repo: string },
    gitRef: string,
  ): Promise<CheckRunSnapshot[]> {
    const rows = await this.octokit.paginate(this.octokit.rest.checks.listForRef, {
      ...repo,
      ref: gitRef,
      per_page: 100,
    });
    return rows.map((c) => ({
      name: c.name,
      status: c.status as CheckRunSnapshot['status'],
      conclusion: (c.conclusion ?? null) as CheckRunSnapshot['conclusion'],
    }));
  }

  // ---- RepoFilesPort ----

  async ensureBranch(
    repo: { owner: string; repo: string },
    branch: string,
    opts?: { orphan?: boolean },
  ): Promise<void> {
    try {
      await this.octokit.rest.git.getRef({ ...repo, ref: `heads/${branch}` });
      return; // exists
    } catch (err) {
      if (!isStatus(err, 404)) throw err;
    }
    if (opts?.orphan) {
      const { data: commit } = await this.octokit.rest.git.createCommit({
        ...repo,
        message: `looper: initialize ${branch}`,
        tree: EMPTY_TREE_SHA,
        parents: [],
      });
      await this.octokit.rest.git.createRef({
        ...repo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
      return;
    }
    const { data: meta } = await this.octokit.rest.repos.get(repo);
    const { data: head } = await this.octokit.rest.git.getRef({
      ...repo,
      ref: `heads/${meta.default_branch}`,
    });
    await this.octokit.rest.git.createRef({
      ...repo,
      ref: `refs/heads/${branch}`,
      sha: head.object.sha,
    });
  }

  async readFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({ ...repo, path, ref: branch });
      if (Array.isArray(data) || data.type !== 'file') {
        throw new Error(`readFile: '${path}' on ${branch} is not a file`);
      }
      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        sha: data.sha,
      };
    } catch (err) {
      if (isStatus(err, 404)) return null;
      throw err;
    }
  }

  async writeFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
    content: string,
    message: string,
    expectedSha?: string,
  ): Promise<{ sha: string }> {
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      ...repo,
      path,
      branch,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(expectedSha ? { sha: expectedSha } : {}),
    });
    return { sha: data.content?.sha ?? '' };
  }

  async listDir(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
  ): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        ...repo,
        path: path === '' ? '.' : path,
        ref: branch,
      });
      if (!Array.isArray(data)) return [];
      return data.map((entry) => entry.name).sort();
    } catch (err) {
      if (isStatus(err, 404)) return [];
      throw err;
    }
  }

  async dispatchWorkflow(
    repo: { owner: string; repo: string },
    workflowFile: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    await this.octokit.rest.actions.createWorkflowDispatch({
      ...repo,
      workflow_id: workflowFile,
      ref,
      inputs,
    });
  }

  // ---- IdentityPort ----

  async getAuthenticatedActor(): Promise<ActorRef> {
    try {
      const { data } = await this.octokit.rest.users.getAuthenticated();
      return { login: data.login, type: data.type === 'Bot' ? 'Bot' : 'User' };
    } catch {
      // GITHUB_TOKEN (installation token) cannot call /user — it acts as the Actions bot.
      return { ...ACTIONS_BOT };
    }
  }

  async getRepoMeta(repo: { owner: string; repo: string }): Promise<{
    defaultBranch: string;
    visibility: 'public' | 'private' | 'internal';
  }> {
    const { data } = await this.octokit.rest.repos.get(repo);
    return {
      defaultBranch: data.default_branch,
      visibility: (data.visibility ?? (data.private ? 'private' : 'public')) as
        | 'public'
        | 'private'
        | 'internal',
    };
  }
}

// ---- mapping helpers ----

interface RawIssueish {
  title?: string;
  body?: string | null;
  state?: string;
  labels?: Array<string | { name?: string }>;
  assignees?: Array<{ login: string }> | null;
  user?: { login: string; type?: string } | null;
  author_association?: string;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
  draft?: boolean;
}

function mapIssue(ref: ItemRef, data: RawIssueish): IssueSnapshot {
  return {
    ref,
    kind: data.pull_request ? 'pull-request' : 'issue',
    title: data.title ?? '',
    body: data.body ?? '',
    state: data.state === 'closed' ? 'closed' : 'open',
    labels: (data.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
    assignees: (data.assignees ?? []).map((a) => a.login),
    author: mapActor(data.user),
    authorAssociation: (data.author_association ?? 'NONE') as IssueSnapshot['authorAssociation'],
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
  };
}

interface RawPull extends RawIssueish {
  head: { ref: string };
  base: { ref: string };
  merged?: boolean;
  merged_at?: string | null;
  mergeable?: boolean | null;
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

function mapPull(ref: ItemRef, data: RawPull): PullRequestSnapshot {
  return {
    ...mapIssue(ref, data),
    kind: 'pull-request',
    headRef: data.head.ref,
    baseRef: data.base.ref,
    draft: data.draft ?? false,
    merged: data.merged ?? data.merged_at != null,
    mergeable: data.mergeable ?? null,
    changedFiles: data.changed_files ?? 0,
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
  };
}

function mapActor(user: { login: string; type?: string } | null | undefined): ActorRef {
  if (!user) return { login: 'ghost', type: 'User' };
  return { login: user.login, type: user.type === 'Bot' ? 'Bot' : 'User' };
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: unknown }).status === status
  );
}
