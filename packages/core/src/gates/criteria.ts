import type { AcceptanceCriterion } from '../ports/plan-store.js';

/**
 * The acceptance-criteria marker block (task 0014): mirrored from the durable
 * plan into the issue body so gates can evaluate from GitHub state alone.
 *
 * <!-- loopdog:acceptance-criteria -->
 * - [ ] per-API-key limiting at 100 req/min   (test: api/ratelimit.test.ts)
 * - [x] returns 429 + Retry-After             (manual)
 * <!-- /loopdog:acceptance-criteria -->
 */

export const CRITERIA_OPEN = '<!-- loopdog:acceptance-criteria -->';
export const CRITERIA_CLOSE = '<!-- /loopdog:acceptance-criteria -->';

export interface CriteriaParse {
  /** null = no marker block present. */
  criteria: AcceptanceCriterion[] | null;
  /** Lines inside the block that did not parse (gates fail closed on these). */
  malformed: string[];
}

export function parseCriteriaBlock(body: string): CriteriaParse {
  const start = body.indexOf(CRITERIA_OPEN);
  const end = body.indexOf(CRITERIA_CLOSE);
  if (start === -1 || end === -1 || end < start) return { criteria: null, malformed: [] };
  const inner = body.slice(start + CRITERIA_OPEN.length, end);

  const criteria: AcceptanceCriterion[] = [];
  const malformed: string[] = [];
  for (const raw of inner.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = line.match(/^- \[([ xX])\] (.+)$/);
    if (!m) {
      malformed.push(line);
      continue;
    }
    const met = m[1] !== ' ';
    const rest = (m[2] ?? '').trim();
    const tag = rest.match(/^(.*?)\s*\((test:\s*([^)]+)|manual)\)\s*$/);
    if (!tag) {
      // Untagged criterion: how it validates is unknown → malformed (fail closed).
      malformed.push(line);
      continue;
    }
    const text = (tag[1] ?? '').trim();
    const validation =
      tag[2] === 'manual'
        ? ({ kind: 'manual' } as const)
        : ({ kind: 'test', ref: (tag[3] ?? '').trim() } as const);
    criteria.push({ text, validation, met });
  }
  return { criteria, malformed };
}

export function renderCriteriaBlock(criteria: readonly AcceptanceCriterion[]): string {
  const lines = criteria.map((c) => {
    const box = c.met ? '[x]' : '[ ]';
    const tag = c.validation.kind === 'test' ? `(test: ${c.validation.ref})` : '(manual)';
    return `- ${box} ${c.text} ${tag}`;
  });
  return [CRITERIA_OPEN, ...lines, CRITERIA_CLOSE].join('\n');
}

/** Replace (or append) the criteria block in an issue body. */
export function upsertCriteriaBlock(
  body: string,
  criteria: readonly AcceptanceCriterion[],
): string {
  const block = renderCriteriaBlock(criteria);
  const start = body.indexOf(CRITERIA_OPEN);
  const end = body.indexOf(CRITERIA_CLOSE);
  if (start === -1 || end === -1 || end < start) {
    return body.trimEnd() + '\n\n' + block + '\n';
  }
  return body.slice(0, start) + block + body.slice(end + CRITERIA_CLOSE.length);
}

/** Scope-bounds marker block, same pattern (DoR requires its presence). */
export const SCOPE_OPEN = '<!-- loopdog:scope -->';
export const SCOPE_CLOSE = '<!-- /loopdog:scope -->';

export function hasScopeBlock(body: string): boolean {
  const start = body.indexOf(SCOPE_OPEN);
  const end = body.indexOf(SCOPE_CLOSE);
  return start !== -1 && end > start && body.slice(start + SCOPE_OPEN.length, end).trim() !== '';
}

/** The scope block's inner text (trimmed), or null when absent/empty. */
export function parseScopeBlock(body: string): string | null {
  const start = body.indexOf(SCOPE_OPEN);
  const end = body.indexOf(SCOPE_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  const inner = body.slice(start + SCOPE_OPEN.length, end).trim();
  return inner === '' ? null : inner;
}
