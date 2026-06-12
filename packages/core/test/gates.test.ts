import { describe, expect, it } from 'vitest';
import {
  evaluateDod,
  evaluateDor,
  parseCriteriaBlock,
  renderCriteriaBlock,
  upsertCriteriaBlock,
} from '@looper/core';
import type { AcceptanceCriterion, CheckRunSnapshot, ReviewSnapshot } from '@looper/core';

const CRITERIA: AcceptanceCriterion[] = [
  {
    text: 'rate limit at 100 req/min',
    validation: { kind: 'test', ref: 'api/rl.test.ts' },
    met: false,
  },
  { text: 'error message is clear', validation: { kind: 'manual' }, met: false },
];

const READY_BODY = [
  'Some issue text.',
  '',
  renderCriteriaBlock(CRITERIA),
  '',
  '<!-- looper:scope -->',
  'Only the api/ratelimit module; no schema changes.',
  '<!-- /looper:scope -->',
].join('\n');

describe('criteria block (0014)', () => {
  it('round-trips render -> parse', () => {
    const { criteria, malformed } = parseCriteriaBlock(renderCriteriaBlock(CRITERIA));
    expect(malformed).toEqual([]);
    expect(criteria).toEqual(CRITERIA);
  });

  it('parses deterministically from a larger body and flags malformed lines', () => {
    const body = [
      '<!-- looper:acceptance-criteria -->',
      '- [x] tagged fine (manual)',
      '- [ ] untagged line — no validation tag',
      'not even a checkbox',
      '<!-- /looper:acceptance-criteria -->',
    ].join('\n');
    const { criteria, malformed } = parseCriteriaBlock(body);
    expect(criteria).toHaveLength(1);
    expect(criteria?.[0]).toEqual({
      text: 'tagged fine',
      validation: { kind: 'manual' },
      met: true,
    });
    expect(malformed).toHaveLength(2);
  });

  it('upserts in place and appends when absent', () => {
    const updated = upsertCriteriaBlock(READY_BODY, [{ ...CRITERIA[0]!, met: true }]);
    expect(updated).toContain('- [x] rate limit at 100 req/min');
    expect(updated).not.toContain('- [ ] rate limit');
    expect(updated).toContain('looper:scope'); // rest of body intact

    const appended = upsertCriteriaBlock('plain body', CRITERIA);
    expect(appended.startsWith('plain body')).toBe(true);
    expect(parseCriteriaBlock(appended).criteria).toHaveLength(2);
  });
});

describe('DoR gate (0014)', () => {
  it('passes a groomed issue (criteria + scope present, all tagged)', () => {
    expect(evaluateDor(READY_BODY)).toEqual({ pass: true, reasons: [] });
  });

  it('blocks when there is no criteria block', () => {
    const r = evaluateDor('just a vague request');
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('no acceptance-criteria block');
  });

  it('blocks on empty criteria, malformed lines, or missing scope (fail closed)', () => {
    const empty = [
      '<!-- looper:acceptance-criteria -->',
      '<!-- /looper:acceptance-criteria -->',
    ].join('\n');
    expect(evaluateDor(empty).pass).toBe(false);

    const malformed = [
      '<!-- looper:acceptance-criteria -->',
      '- [ ] untagged criterion',
      '<!-- /looper:acceptance-criteria -->',
      '<!-- looper:scope -->bounded<!-- /looper:scope -->',
    ].join('\n');
    const r = evaluateDor(malformed);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('malformed');

    const noScope = renderCriteriaBlock(CRITERIA);
    expect(evaluateDor(noScope).reasons.join(' ')).toContain('no scope block');
  });
});

const GREEN_CHECKS: CheckRunSnapshot[] = [
  { name: 'lint', status: 'completed', conclusion: 'success' },
  { name: 'test', status: 'completed', conclusion: 'success' },
];
const APPROVED: ReviewSnapshot[] = [
  {
    author: { login: 'reviewer', type: 'User' },
    state: 'APPROVED',
    submittedAt: '2026-06-09T10:00:00Z',
    body: 'lgtm',
  },
];

describe('DoD gate (0014)', () => {
  const doneBody = upsertCriteriaBlock(
    READY_BODY,
    CRITERIA.map((c) => ({ ...c, met: true })),
  );

  it('passes when criteria met + required checks green + approved', () => {
    const r = evaluateDod({
      issueBody: doneBody,
      checkRuns: GREEN_CHECKS,
      requiredChecks: ['lint', 'test'],
      reviews: APPROVED,
    });
    expect(r).toEqual({ pass: true, reasons: [] });
  });

  it('blocks on unmet criteria', () => {
    const r = evaluateDod({
      issueBody: READY_BODY,
      checkRuns: GREEN_CHECKS,
      requiredChecks: ['lint'],
      reviews: APPROVED,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('unmet');
  });

  it('blocks on missing or red required checks', () => {
    const missing = evaluateDod({
      issueBody: doneBody,
      checkRuns: GREEN_CHECKS,
      requiredChecks: ['lint', 'build'],
      reviews: APPROVED,
    });
    expect(missing.reasons.join(' ')).toContain("'build' has not reported");

    const red = evaluateDod({
      issueBody: doneBody,
      checkRuns: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      requiredChecks: ['lint'],
      reviews: APPROVED,
    });
    expect(red.reasons.join(' ')).toContain("'lint' is failure");
  });

  it('blocks without approval; latest review per author decides', () => {
    const flipped: ReviewSnapshot[] = [
      { ...APPROVED[0]!, state: 'CHANGES_REQUESTED', submittedAt: '2026-06-09T09:00:00Z' },
      { ...APPROVED[0]!, state: 'APPROVED', submittedAt: '2026-06-09T11:00:00Z' },
    ];
    expect(
      evaluateDod({
        issueBody: doneBody,
        checkRuns: GREEN_CHECKS,
        requiredChecks: ['lint'],
        reviews: flipped,
      }).pass,
    ).toBe(true);

    expect(
      evaluateDod({
        issueBody: doneBody,
        checkRuns: GREEN_CHECKS,
        requiredChecks: ['lint'],
        reviews: [],
      }).reasons,
    ).toContain('no approving review');
  });

  it('blocks on failed deploy smoke when the loop deploys', () => {
    const r = evaluateDod({
      issueBody: doneBody,
      checkRuns: GREEN_CHECKS,
      requiredChecks: ['lint'],
      reviews: APPROVED,
      deploySmoke: { passed: false },
    });
    expect(r.reasons).toContain('deploy smoke failed');
  });
});
