import type { DispatchHandle, GitHubPort, IngestResult, PullRequestSnapshot } from '@loopdog/core';

/**
 * Dispatch → result correlation (task 0073): defense in depth, never one
 * signal. Match precedence over candidate PRs:
 *   1. branch name  `loopdog/<loop>/<issue>-<run_id>`   (agent-obeyed)
 *   2. PR body trailer `loopdog-run: <run_id>`           (agent-obeyed backup)
 *   3. issue ref `#<issue>` + bot author + opened after dispatch (weakest)
 * A PR matching none is NOT ours. The dispatch-time signal in the handle
 * (session id / comment id / workflow run) is the authoritative record of the
 * dispatch itself (0093 decision) — it guards dedup and timeout, while the
 * PR match identifies the artifact.
 */

export type MatchKind = 'branch-name' | 'pr-trailer' | 'issue-ref';

export function correlatePr(handle: DispatchHandle, pr: PullRequestSnapshot): MatchKind | null {
  if (pr.headRef === handle.expectedBranch) return 'branch-name';
  if (pr.body.includes(handle.expectedTrailer)) return 'pr-trailer';
  const referencesIssue = new RegExp(`#${handle.item.number}\\b`).test(pr.body);
  const afterDispatch = Date.parse(pr.createdAt) >= Date.parse(handle.dispatchedAt) - 60_000;
  if (referencesIssue && pr.author.type === 'Bot' && afterDispatch) return 'issue-ref';
  return null;
}

/**
 * Find the dispatched run's resulting PR. Searches by the branch prefix first
 * (cheap, exact), then scans open PRs for the trailer/issue-ref fallbacks.
 */
export async function findCorrelatedPr(
  gh: GitHubPort,
  handle: DispatchHandle,
): Promise<{ pr: PullRequestSnapshot; matchedBy: MatchKind } | null> {
  const repo = { owner: handle.item.owner, repo: handle.item.repo };

  const byBranch = await gh.listPullRequestsByHeadPrefix(repo, handle.expectedBranch, {
    state: 'all',
  });
  if (byBranch[0]) return { pr: byBranch[0], matchedBy: 'branch-name' };

  // Fallback scan (the agent ignored the branch instruction — 0093's risk).
  const open = await gh.listPullRequestsByHeadPrefix(repo, '', { state: 'open' });
  for (const pr of open) {
    const match = correlatePr(handle, pr);
    if (match) return { pr, matchedBy: match };
  }
  return null;
}

/** Shared ingest used by every backend: pending until a correlated PR exists. */
export async function ingestViaCorrelation(
  gh: GitHubPort,
  handle: DispatchHandle,
): Promise<IngestResult> {
  if (handle.expectation === 'pull-request') {
    const found = await findCorrelatedPr(gh, handle);
    if (!found) return { status: 'pending' };
    // Fix-loop case (0044): when the PR pre-existed the dispatch, completion
    // means the agent PUSHED (updatedAt after dispatch) — not mere existence.
    const updatedAfterDispatch =
      Date.parse(found.pr.updatedAt) >= Date.parse(handle.dispatchedAt) - 60_000;
    if (!updatedAfterDispatch) return { status: 'pending' };
    return { status: 'completed', pr: found.pr, matchedBy: found.matchedBy };
  }
  // comment / plan-update expectations: find the work cell's summary comment.
  //
  // The completion signal is the `loopdog-verdict:` line the prompt always
  // emits — NOT the trailer alone, because loopdog's own dispatch-marker comment
  // carries the trailer too (matching it would silently auto-pass review). So we
  // only consider comments that carry a verdict, then prefer the one bearing
  // this run's trailer (disambiguates concurrent runs). Author is NOT a signal:
  // a Claude routine posts as the USER, not a bot — requiring `Bot` here broke
  // ingestion for the whole subscription path.
  const comments = await gh.listComments(handle.item);
  const verdicts = comments.filter((c) => /(^|\n)\s*loopdog-verdict:\s*\S+/.test(c.body));
  const ours =
    verdicts.find((c) => c.body.includes(handle.expectedTrailer)) ?? verdicts[verdicts.length - 1];
  if (ours) {
    const matchedBy = ours.body.includes(handle.expectedTrailer) ? 'pr-trailer' : 'issue-ref';
    return { status: 'completed', commentId: ours.id, matchedBy };
  }
  return { status: 'pending' };
}
