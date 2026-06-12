import type { CheckRunSnapshot, ReviewSnapshot } from '../ports/types.js';
import type { GateResult } from './dor.js';
import { parseCriteriaBlock } from './criteria.js';

/**
 * Definition-of-Done gate (task 0014): merge is blocked unless every
 * acceptance criterion is checked, required CI is green, review is approved,
 * and (when the loop deploys) deploy smoke passed. `test:`-tagged criteria are
 * objectively validated by CI (ladder rung 2); `manual:` ones by the
 * intent-diff reviewer (M10 · 0043) — DoD treats both as "must be checked".
 */
export interface DodInput {
  issueBody: string;
  checkRuns: readonly CheckRunSnapshot[];
  requiredChecks: readonly string[];
  reviews: readonly ReviewSnapshot[];
  /** Pass when the loop deploys; omit otherwise. */
  deploySmoke?: { passed: boolean } | undefined;
}

export function evaluateDod(input: DodInput): GateResult {
  const reasons: string[] = [];

  const { criteria, malformed } = parseCriteriaBlock(input.issueBody);
  if (criteria === null) {
    reasons.push('no acceptance-criteria block present — nothing to validate against');
  } else {
    if (malformed.length > 0) {
      reasons.push(`acceptance-criteria block has malformed line(s) — fail closed`);
    }
    const unmet = criteria.filter((c) => !c.met);
    if (unmet.length > 0) {
      reasons.push(
        `${unmet.length} acceptance criterion(s) unmet: ${unmet.map((c) => c.text).join('; ')}`,
      );
    }
  }

  for (const name of input.requiredChecks) {
    const run = input.checkRuns.find((c) => c.name === name);
    if (!run) {
      reasons.push(`required check '${name}' has not reported`);
    } else if (run.status !== 'completed' || run.conclusion !== 'success') {
      reasons.push(`required check '${name}' is ${run.conclusion ?? run.status}`);
    }
  }

  const decided = latestReviewByAuthor(input.reviews);
  const changesRequested = decided.filter((r) => r.state === 'CHANGES_REQUESTED');
  const approved = decided.some((r) => r.state === 'APPROVED');
  if (changesRequested.length > 0) {
    reasons.push(`changes requested by ${changesRequested.map((r) => r.author.login).join(', ')}`);
  }
  if (!approved) {
    reasons.push('no approving review');
  }

  if (input.deploySmoke && !input.deploySmoke.passed) {
    reasons.push('deploy smoke failed');
  }

  return { pass: reasons.length === 0, reasons };
}

/** Latest non-pending review per author decides that author's stance. */
function latestReviewByAuthor(reviews: readonly ReviewSnapshot[]): ReviewSnapshot[] {
  const byAuthor = new Map<string, ReviewSnapshot>();
  for (const r of reviews) {
    if (r.state === 'PENDING' || r.state === 'COMMENTED') continue;
    const prev = byAuthor.get(r.author.login);
    if (!prev || Date.parse(r.submittedAt) >= Date.parse(prev.submittedAt)) {
      byAuthor.set(r.author.login, r);
    }
  }
  return [...byAuthor.values()].filter((r) => r.state !== 'DISMISSED');
}
