import { hasScopeBlock, parseCriteriaBlock } from './criteria.js';

/**
 * Definition-of-Ready gate (task 0014): the implement loop refuses to start
 * unless readiness holds. Evaluated over the issue body alone (the criteria
 * block is the plan's mirror). Fails CLOSED on malformed criteria.
 */
export interface GateResult {
  pass: boolean;
  reasons: string[];
}

export function evaluateDor(issueBody: string): GateResult {
  const reasons: string[] = [];
  const { criteria, malformed } = parseCriteriaBlock(issueBody);

  if (criteria === null) {
    reasons.push('no acceptance-criteria block present (groom the issue first)');
  } else {
    if (malformed.length > 0) {
      reasons.push(
        `acceptance-criteria block has ${malformed.length} malformed line(s) — fail closed: ${malformed[0]}`,
      );
    }
    if (criteria.length === 0) {
      reasons.push('acceptance-criteria block is empty (need >= 1 criterion)');
    }
    // The test-plan requirement: every criterion is tagged test:/manual by the
    // parser (untagged lines land in `malformed`), so presence of >= 1 parsed
    // criterion implies a validation plan per criterion.
  }

  if (!hasScopeBlock(issueBody)) {
    reasons.push('no scope block present (scope bounds are required for readiness)');
  }

  return { pass: reasons.length === 0, reasons };
}

/** Where the runner routes a DoR-failing item (0014: back to grooming). */
export const DOR_FAIL_ROUTE = 'needs-grooming';
