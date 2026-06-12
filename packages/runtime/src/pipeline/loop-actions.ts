import type {
  CheckRunSnapshot,
  GitHubPort,
  IssueSnapshot,
  LoopDefinition,
  PullRequestSnapshot,
} from '@looper/core';
import { evaluateDod } from '@looper/core';

/**
 * Per-loop-kind behaviors layered on the generic runner (M08-M11):
 * verdict parsing (groom/review), blast-radius guards (implement), the
 * DoD-gated merge action, and check-gated deterministic transitions
 * (deploy smoke). Loops stay data — these consult only LoopDefinition fields.
 */

// ---- verdicts (0033/0035/0042/0043) ----

const VERDICT_RE = /looper-verdict:\s*([a-z-]+)/i;

export function parseVerdict(body: string): string | null {
  const m = body.match(VERDICT_RE);
  return m ? m[1]!.toLowerCase() : null;
}

/** Where a verdict lands the item: approving verdicts → `to`; else fallback. */
export function verdictTarget(loop: LoopDefinition, verdict: string | null): string {
  if (verdict === null) return loop.transition.to; // no verdict = success-shaped result
  if (['approve', 'approved', 'ready', 'done', 'pass'].includes(verdict)) {
    return loop.transition.to;
  }
  return loop.transition.fallback ?? loop.transition.to;
}

// ---- blast radius (0038) ----

export interface BlastRadiusViolation {
  reason: string;
}

export function checkBlastRadius(
  loop: LoopDefinition,
  pr: PullRequestSnapshot,
  changedFiles: readonly string[],
): BlastRadiusViolation | null {
  const limits = loop.blastRadius;
  if (!limits) return null;
  if (limits.maxFiles !== undefined && pr.changedFiles > limits.maxFiles) {
    return {
      reason: `PR touches ${pr.changedFiles} files — over the loop's max_files=${limits.maxFiles}`,
    };
  }
  const diff = pr.additions + pr.deletions;
  if (limits.maxDiffLines !== undefined && diff > limits.maxDiffLines) {
    return { reason: `PR diff is ${diff} lines — over the loop's max_diff=${limits.maxDiffLines}` };
  }
  for (const forbidden of limits.forbiddenPaths ?? []) {
    const hit = changedFiles.find((f) => matchGlob(forbidden, f));
    if (hit) {
      return { reason: `PR touches forbidden path '${hit}' (forbidden_paths: ${forbidden})` };
    }
  }
  return null;
}

function matchGlob(pattern: string, path: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*') +
      '$',
  );
  return re.test(path) || path.startsWith(pattern.replace(/\/?\*\*$/, '') + '/');
}

// ---- check gates (0041/0047) ----

export type CheckGateResult = 'green' | 'red' | 'waiting';

export function evaluateRequiredChecks(
  checkRuns: readonly CheckRunSnapshot[],
  required: readonly string[],
): CheckGateResult {
  let waiting = false;
  for (const name of required) {
    const run = checkRuns.find((c) => c.name === name);
    if (!run || run.status !== 'completed') {
      waiting = true;
      continue;
    }
    if (run.conclusion !== 'success') return 'red';
  }
  return waiting ? 'waiting' : 'green';
}

// ---- merge action (0045) ----

export type MergeDecision =
  | { action: 'merge' }
  | { action: 'blocked'; reasons: string[] }
  | { action: 'waiting'; reasons: string[] };

/**
 * Graduated auto-merge (0045): merge only when the DoD gate passes. The
 * config-side guard (promote refuses tier:core merge loops in act mode) is
 * the policy; this is the runtime check that every rung actually passed.
 */
export async function decideMerge(
  gh: GitHubPort,
  loop: LoopDefinition,
  pr: PullRequestSnapshot,
): Promise<MergeDecision> {
  const repo = { owner: pr.ref.owner, repo: pr.ref.repo };
  const [checkRuns, reviews] = await Promise.all([
    gh.listCheckRuns(repo, pr.headRef),
    gh.listReviews(pr.ref),
  ]);

  // Criteria live on the bound issue; resolve it via the PR's #N reference.
  let criteriaBody = pr.body;
  const issueRef = pr.body.match(/#(\d+)\b/);
  if (issueRef) {
    try {
      criteriaBody = (await gh.getIssue({ ...repo, number: Number(issueRef[1]) })).body;
    } catch {
      // unresolvable reference — fall back to the PR body (fail closed below)
    }
  }

  const dod = evaluateDod({
    issueBody: criteriaBody,
    checkRuns,
    requiredChecks: loop.gates.requiredChecks ?? [],
    reviews,
  });
  if (dod.pass) return { action: 'merge' };

  const waiting = dod.reasons.every((r) => r.includes('has not reported'));
  return waiting
    ? { action: 'waiting', reasons: dod.reasons }
    : { action: 'blocked', reasons: dod.reasons };
}

/** The issue an artifact (PR) is bound to, via its `#N` reference. */
export async function linkedIssue(
  gh: GitHubPort,
  pr: PullRequestSnapshot,
): Promise<IssueSnapshot | null> {
  const m = pr.body.match(/#(\d+)\b/);
  if (!m) return null;
  try {
    return await gh.getIssue({ owner: pr.ref.owner, repo: pr.ref.repo, number: Number(m[1]) });
  } catch {
    return null;
  }
}
