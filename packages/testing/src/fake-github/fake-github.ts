import type {
  ActorRef,
  CheckRunSnapshot,
  Clock,
  CommentSnapshot,
  GitHubPort,
  IssueSnapshot,
  ItemRef,
  LabelSpec,
  PullRequestSnapshot,
  ReviewSnapshot,
} from '@loopdog/core';

/**
 * In-memory `GitHubPort` (task 0083): issues/PRs/labels/comments/checks/files
 * the real controller drives offline — deterministic, no network, no quota.
 * Every mutation is appended to `mutations` for golden assertions (0085).
 */
export class FakeGitHub implements GitHubPort {
  private issues = new Map<string, IssueSnapshot>();
  private pulls = new Map<string, PullRequestSnapshot>();
  private comments = new Map<string, CommentSnapshot[]>();
  private repoLabels = new Map<string, LabelSpec[]>();
  private checkRuns = new Map<string, CheckRunSnapshot[]>();
  private reviews = new Map<string, ReviewSnapshot[]>();
  private branches = new Map<string, Map<string, { content: string; sha: string }>>();
  private shaCounter = 0;
  private commentCounter = 0;
  private issueCounter = new Map<string, number>();

  /** Append-only log of writes, for golden assertions. */
  readonly mutations: string[] = [];

  actor: ActorRef = { login: 'github-actions[bot]', type: 'Bot' };
  /** Base instant for the fake's deterministic monotonic clock. */
  clockBase = '2026-06-09T12:00:00Z';
  /**
   * Optional virtual clock (0086): when set, mutations bump `updatedAt` and
   * new comments timestamp at clock-time, so time-based correlation (the
   * fix-loop `updatedAfterDispatch` guard, 0073) is exercised under
   * simulation. Unset → the fixed monotonic default (existing tests).
   */
  clock?: Clock;
  defaultBranch = 'main';
  visibility: 'public' | 'private' | 'internal' = 'public';

  /**
   * Fault injection hook (0086): called before every operation with its name;
   * throw from it to simulate API failures.
   */
  beforeOp: (op: string) => void = () => {};

  /** Read-only state dump for golden snapshots (0085). */
  dump(): {
    issues: IssueSnapshot[];
    pulls: PullRequestSnapshot[];
    comments: Array<{ item: number; bodies: string[] }>;
    files: Array<{ path: string; content: string }>;
  } {
    const comments: Array<{ item: number; bodies: string[] }> = [];
    for (const [key, list] of this.comments) {
      const number = Number(key.split('#')[1]);
      comments.push({ item: number, bodies: list.map((c) => c.body) });
    }
    const files: Array<{ path: string; content: string }> = [];
    for (const branch of this.branches.values()) {
      for (const [path, file] of branch) files.push({ path, content: file.content });
    }
    return {
      issues: [...this.issues.values()].map((i) => structuredClone(i)),
      pulls: [...this.pulls.values()].map((p) => structuredClone(p)),
      comments,
      files,
    };
  }

  // ---- seeding helpers (test setup) ----

  seedIssue(partial: Partial<IssueSnapshot> & { ref: ItemRef }): IssueSnapshot {
    const issue: IssueSnapshot = {
      kind: 'issue',
      title: 'seeded issue',
      body: '',
      state: 'open',
      labels: [],
      assignees: [],
      author: { login: 'human', type: 'User' },
      authorAssociation: 'OWNER',
      createdAt: '2026-06-09T00:00:00Z',
      updatedAt: '2026-06-09T00:00:00Z',
      ...partial,
    };
    this.issues.set(key(issue.ref), issue);
    this.issueCounter.set(
      repoKey(issue.ref),
      Math.max(this.issueCounter.get(repoKey(issue.ref)) ?? 0, issue.ref.number),
    );
    return issue;
  }

  seedPull(
    partial: Partial<PullRequestSnapshot> & { ref: ItemRef; headRef: string },
  ): PullRequestSnapshot {
    const pr: PullRequestSnapshot = {
      kind: 'pull-request',
      title: 'seeded pr',
      body: '',
      state: 'open',
      labels: [],
      assignees: [],
      author: { login: 'provider[bot]', type: 'Bot' },
      authorAssociation: 'NONE',
      createdAt: this.clock?.().toISOString() ?? '2026-06-09T00:00:00Z',
      updatedAt: this.clock?.().toISOString() ?? '2026-06-09T00:00:00Z',
      baseRef: 'main',
      draft: false,
      merged: false,
      mergeable: true,
      changedFiles: 1,
      additions: 1,
      deletions: 0,
      ...partial,
    };
    this.pulls.set(key(pr.ref), pr);
    this.issueCounter.set(
      repoKey(pr.ref),
      Math.max(this.issueCounter.get(repoKey(pr.ref)) ?? 0, pr.ref.number),
    );
    return pr;
  }

  setCheckRuns(
    repo: { owner: string; repo: string },
    gitRef: string,
    runs: CheckRunSnapshot[],
  ): void {
    this.checkRuns.set(`${repo.owner}/${repo.repo}@${gitRef}`, runs);
  }

  setReviews(ref: ItemRef, reviews: ReviewSnapshot[]): void {
    this.reviews.set(key(ref), reviews);
  }

  // ---- IssuesPort ----

  async getIssue(ref: ItemRef): Promise<IssueSnapshot> {
    this.beforeOp('getIssue');
    const found = this.issues.get(key(ref)) ?? this.pulls.get(key(ref));
    if (!found) throw new Error(`fake: no issue ${key(ref)}`);
    return structuredClone(found);
  }

  async listIssuesByLabel(
    repo: { owner: string; repo: string },
    label: string,
  ): Promise<IssueSnapshot[]> {
    this.beforeOp('listIssuesByLabel');
    return [...this.issues.values(), ...this.pulls.values()]
      .filter(
        (i) =>
          i.ref.owner === repo.owner &&
          i.ref.repo === repo.repo &&
          i.state === 'open' &&
          i.labels.includes(label),
      )
      .map((i) => structuredClone(i));
  }

  async updateIssueBody(ref: ItemRef, body: string): Promise<void> {
    this.beforeOp('updateIssueBody');
    this.mutate(ref).body = body;
    this.mutations.push(`updateIssueBody ${key(ref)}`);
  }

  async createIssue(
    repo: { owner: string; repo: string },
    draft: { title: string; body: string; labels?: string[] },
  ): Promise<ItemRef> {
    this.beforeOp('createIssue');
    const number = (this.issueCounter.get(`${repo.owner}/${repo.repo}`) ?? 0) + 1;
    this.issueCounter.set(`${repo.owner}/${repo.repo}`, number);
    const ref = { ...repo, number };
    this.seedIssue({ ref, title: draft.title, body: draft.body, labels: draft.labels ?? [] });
    this.mutations.push(`createIssue ${key(ref)} "${draft.title}"`);
    return ref;
  }

  async listComments(ref: ItemRef): Promise<CommentSnapshot[]> {
    this.beforeOp('listComments');
    return structuredClone(this.comments.get(key(ref)) ?? []);
  }

  async createComment(ref: ItemRef, body: string): Promise<{ id: number }> {
    this.beforeOp('createComment');
    const id = ++this.commentCounter;
    const list = this.comments.get(key(ref)) ?? [];
    list.push({
      id,
      body,
      author: structuredClone(this.actor),
      authorAssociation: 'NONE',
      // deterministic monotonic clock: comment N is N seconds past the base
      // (or clock-time when a virtual clock is injected, +id ms to stay unique)
      createdAt: this.clock
        ? new Date(this.clock().getTime() + id).toISOString()
        : new Date(Date.parse(this.clockBase) + id * 1000).toISOString(),
    });
    this.comments.set(key(ref), list);
    this.mutations.push(`createComment ${key(ref)} #${id}`);
    return { id };
  }

  async updateComment(ref: ItemRef, commentId: number, body: string): Promise<void> {
    this.beforeOp('updateComment');
    const found = (this.comments.get(key(ref)) ?? []).find((c) => c.id === commentId);
    if (!found) throw new Error(`fake: no comment ${commentId} on ${key(ref)}`);
    found.body = body;
    this.mutations.push(`updateComment ${key(ref)} #${commentId}`);
  }

  async addAssignees(ref: ItemRef, logins: string[]): Promise<void> {
    this.beforeOp('addAssignees');
    const item = this.mutate(ref);
    item.assignees = [...new Set([...item.assignees, ...logins])];
    this.mutations.push(`addAssignees ${key(ref)} ${logins.join(',')}`);
  }

  async removeAssignees(ref: ItemRef, logins: string[]): Promise<void> {
    this.beforeOp('removeAssignees');
    const item = this.mutate(ref);
    item.assignees = item.assignees.filter((a) => !logins.includes(a));
    this.mutations.push(`removeAssignees ${key(ref)} ${logins.join(',')}`);
  }

  // ---- LabelsPort ----

  async listRepoLabels(repo: { owner: string; repo: string }): Promise<LabelSpec[]> {
    this.beforeOp('listRepoLabels');
    return structuredClone(this.repoLabels.get(`${repo.owner}/${repo.repo}`) ?? []);
  }

  async createRepoLabel(repo: { owner: string; repo: string }, label: LabelSpec): Promise<void> {
    this.beforeOp('createRepoLabel');
    const list = this.repoLabels.get(`${repo.owner}/${repo.repo}`) ?? [];
    if (list.some((l) => l.name === label.name)) {
      throw new Error(`fake: label '${label.name}' already exists`);
    }
    list.push(structuredClone(label));
    this.repoLabels.set(`${repo.owner}/${repo.repo}`, list);
    this.mutations.push(`createRepoLabel ${repo.owner}/${repo.repo} ${label.name}`);
  }

  async getItemLabels(ref: ItemRef): Promise<string[]> {
    this.beforeOp('getItemLabels');
    return [...this.mutate(ref).labels];
  }

  async addLabels(ref: ItemRef, labels: string[]): Promise<void> {
    this.beforeOp('addLabels');
    const item = this.mutate(ref);
    item.labels = [...new Set([...item.labels, ...labels])];
    this.mutations.push(`addLabels ${key(ref)} ${labels.join(',')}`);
  }

  async removeLabel(ref: ItemRef, label: string): Promise<void> {
    this.beforeOp('removeLabel');
    const item = this.mutate(ref);
    item.labels = item.labels.filter((l) => l !== label); // idempotent
    this.mutations.push(`removeLabel ${key(ref)} ${label}`);
  }

  // ---- PullsPort ----

  async getPullRequest(ref: ItemRef): Promise<PullRequestSnapshot> {
    this.beforeOp('getPullRequest');
    const pr = this.pulls.get(key(ref));
    if (!pr) throw new Error(`fake: no PR ${key(ref)}`);
    return structuredClone(pr);
  }

  async listPullRequestsByHeadPrefix(
    repo: { owner: string; repo: string },
    prefix: string,
    opts?: { state?: 'open' | 'closed' | 'all' },
  ): Promise<PullRequestSnapshot[]> {
    this.beforeOp('listPullRequestsByHeadPrefix');
    const state = opts?.state ?? 'open';
    return [...this.pulls.values()]
      .filter(
        (pr) =>
          pr.ref.owner === repo.owner &&
          pr.ref.repo === repo.repo &&
          pr.headRef.startsWith(prefix) &&
          (state === 'all' || pr.state === state),
      )
      .map((pr) => structuredClone(pr));
  }

  async listPullRequestFiles(ref: ItemRef): Promise<string[]> {
    this.beforeOp('listPullRequestFiles');
    const pr = this.pulls.get(key(ref));
    if (!pr) throw new Error(`fake: no PR ${key(ref)}`);
    return Array.from({ length: pr.changedFiles }, (_, i) => `file-${i}.txt`);
  }

  async listReviews(ref: ItemRef): Promise<ReviewSnapshot[]> {
    this.beforeOp('listReviews');
    return structuredClone(this.reviews.get(key(ref)) ?? []);
  }

  async mergePullRequest(
    ref: ItemRef,
    opts: { method: 'merge' | 'squash' | 'rebase'; expectedHeadSha?: string },
  ): Promise<{ merged: boolean; sha?: string | undefined }> {
    this.beforeOp('mergePullRequest');
    const pr = this.pulls.get(key(ref));
    if (!pr) throw new Error(`fake: no PR ${key(ref)}`);
    if (pr.merged) return { merged: true };
    pr.merged = true;
    pr.state = 'closed';
    this.mutations.push(`mergePullRequest ${key(ref)} via ${opts.method}`);
    return { merged: true, sha: this.nextSha() };
  }

  async requestReviewers(ref: ItemRef, logins: string[]): Promise<void> {
    this.beforeOp('requestReviewers');
    this.mutations.push(`requestReviewers ${key(ref)} ${logins.join(',')}`);
  }

  // ---- ChecksPort ----

  async listCheckRuns(
    repo: { owner: string; repo: string },
    gitRef: string,
  ): Promise<CheckRunSnapshot[]> {
    this.beforeOp('listCheckRuns');
    return structuredClone(this.checkRuns.get(`${repo.owner}/${repo.repo}@${gitRef}`) ?? []);
  }

  // ---- RepoFilesPort ----

  async ensureBranch(
    repo: { owner: string; repo: string },
    branch: string,
    _opts?: { orphan?: boolean },
  ): Promise<void> {
    this.beforeOp('ensureBranch');
    const k = `${repo.owner}/${repo.repo}@${branch}`;
    if (!this.branches.has(k)) {
      this.branches.set(k, new Map());
      this.mutations.push(`ensureBranch ${k}`);
    }
  }

  async readFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
  ): Promise<{ content: string; sha: string } | null> {
    this.beforeOp('readFile');
    const file = this.branches.get(`${repo.owner}/${repo.repo}@${branch}`)?.get(path);
    return file ? { ...file } : null;
  }

  async writeFile(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
    content: string,
    _message: string,
    expectedSha?: string,
  ): Promise<{ sha: string }> {
    this.beforeOp('writeFile');
    const k = `${repo.owner}/${repo.repo}@${branch}`;
    const files = this.branches.get(k);
    if (!files) throw new Error(`fake: branch ${k} does not exist (ensureBranch first)`);
    const existing = files.get(path);
    if (existing && expectedSha !== existing.sha) {
      throw new Error(`fake: sha mismatch on ${path} (lost race)`);
    }
    if (!existing && expectedSha) {
      throw new Error(`fake: expectedSha given but ${path} does not exist`);
    }
    const sha = this.nextSha();
    files.set(path, { content, sha });
    this.mutations.push(`writeFile ${k}:${path}`);
    return { sha };
  }

  async listDir(
    repo: { owner: string; repo: string },
    branch: string,
    path: string,
  ): Promise<string[]> {
    this.beforeOp('listDir');
    const files = this.branches.get(`${repo.owner}/${repo.repo}@${branch}`);
    if (!files) return [];
    const prefix = path === '' || path === '.' ? '' : path.replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const p of files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const first = rest.split('/')[0];
      if (first) names.add(first);
    }
    return [...names].sort();
  }

  /** workflow_dispatch deliveries recorded for assertions (0074). */
  readonly workflowDispatches: Array<{
    repo: string;
    workflowFile: string;
    ref: string;
    inputs: Record<string, string>;
  }> = [];

  async dispatchWorkflow(
    repo: { owner: string; repo: string },
    workflowFile: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    this.beforeOp('dispatchWorkflow');
    this.workflowDispatches.push({
      repo: `${repo.owner}/${repo.repo}`,
      workflowFile,
      ref,
      inputs: { ...inputs },
    });
    this.mutations.push(`dispatchWorkflow ${repo.owner}/${repo.repo} ${workflowFile}`);
  }

  // ---- IdentityPort ----

  async getAuthenticatedActor(): Promise<ActorRef> {
    this.beforeOp('getAuthenticatedActor');
    return structuredClone(this.actor);
  }

  async getRepoMeta(_repo: { owner: string; repo: string }): Promise<{
    defaultBranch: string;
    visibility: 'public' | 'private' | 'internal';
  }> {
    this.beforeOp('getRepoMeta');
    return { defaultBranch: this.defaultBranch, visibility: this.visibility };
  }

  // ---- internals ----

  private mutate(ref: ItemRef): IssueSnapshot {
    const found = this.issues.get(key(ref)) ?? this.pulls.get(key(ref));
    if (!found) throw new Error(`fake: no item ${key(ref)}`);
    // Under a virtual clock, every mutation advances the item's updatedAt so
    // time-based correlation (the fix-loop updatedAfterDispatch guard) works.
    if (this.clock) found.updatedAt = this.clock().toISOString();
    return found;
  }

  private nextSha(): string {
    return `sha-${(++this.shaCounter).toString().padStart(6, '0')}`;
  }
}

function key(ref: ItemRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

function repoKey(ref: ItemRef): string {
  return `${ref.owner}/${ref.repo}`;
}
