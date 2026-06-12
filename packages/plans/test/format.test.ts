import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FORMAT_VERSION,
  MILESTONE_TEMPLATE,
  TASK_TEMPLATE,
  appendToSection,
  assertSupportedFormatVersion,
  checkItem,
  getHeaderField,
  getSection,
  parsePlan,
  renderTemplate,
  serializePlan,
  setHeaderField,
  setStatus,
} from '@looper/plans';

const FIXTURE = `# 0042 Add Rate Limiting

Status: ready
Branch: looper/implement/7
Issue: #7

## Goal

Limit the API.

## Acceptance Criteria

<!-- looper:acceptance-criteria -->
- [ ] limits at 100 req/min (test: rl.test.ts)
- [ ] clear error message (manual)
<!-- /looper:acceptance-criteria -->

## Implementation Checklist

- [ ] add middleware
- [ ] add tests

## Verification Log

Add dated entries here as work proceeds.

## Final Summary

Fill this in before marking verified.
`;

describe('plan format (0015)', () => {
  it('round-trips parse -> serialize byte-for-byte', () => {
    expect(serializePlan(parsePlan(FIXTURE))).toBe(FIXTURE);
    // milestone shape too
    const milestone = renderTemplate(MILESTONE_TEMPLATE, {
      id: '04',
      title: 'Durable Planning Store',
      status: 'planned',
      objective: 'Plans as memory.',
      definitionOfDone: '- plans bind',
    });
    expect(serializePlan(parsePlan(milestone))).toBe(milestone);
    expect(parsePlan(milestone)).toMatchObject({ kind: 'milestone', id: '04' });
  });

  it('parses the header fields and sections', () => {
    const doc = parsePlan(FIXTURE);
    expect(doc).toMatchObject({
      kind: 'task',
      id: '0042',
      title: 'Add Rate Limiting',
      status: 'ready',
    });
    expect(getHeaderField(doc, 'Issue')).toBe('#7');
    expect(getSection(doc, 'Goal')).toContain('Limit the API.');
  });

  it('setStatus mutates only the Status line', () => {
    const next = serializePlan(setStatus(parsePlan(FIXTURE), 'verified'));
    expect(next).toContain('Status: verified');
    expect(next.replace('Status: verified', 'Status: ready')).toBe(FIXTURE);
  });

  it('checkItem mutates only the named item in the named section', () => {
    const next = serializePlan(
      checkItem(parsePlan(FIXTURE), 'Implementation Checklist', 'middleware'),
    );
    expect(next).toContain('- [x] add middleware');
    expect(next).toContain('- [ ] add tests');
    expect(next).toContain('- [ ] limits at 100 req/min'); // criteria untouched
  });

  it('appendToSection and setHeaderField are additive + lossless elsewhere', () => {
    let doc = appendToSection(parsePlan(FIXTURE), 'Verification Log', '- 2026-06-09: tested.');
    doc = setHeaderField(doc, 'Milestone', '04');
    const out = serializePlan(doc);
    expect(out).toContain('- 2026-06-09: tested.');
    expect(out).toContain('Milestone: 04');
    expect(out).toContain('Add dated entries here as work proceeds.');
    expect(out).toContain('## Final Summary');
  });

  it('template assets match the embedded templates (drift guard)', () => {
    const dir = fileURLToPath(new URL('../templates/', import.meta.url));
    expect(readFileSync(`${dir}task.md`, 'utf8')).toBe(TASK_TEMPLATE);
    expect(readFileSync(`${dir}milestone.md`, 'utf8')).toBe(MILESTONE_TEMPLATE);
    // required section set (PLANS.md)
    for (const section of [
      '## Goal',
      '## Background',
      '## Scope',
      '## Out Of Scope',
      '## Acceptance Criteria',
      '## Implementation Checklist',
      '## Test Plan',
      '## Verification Log',
      '## Decisions',
      '## Risks / Rollback',
      '## Final Summary',
    ]) {
      expect(TASK_TEMPLATE).toContain(section);
    }
  });

  it('refuses a newer format_version with guidance', () => {
    expect(() => assertSupportedFormatVersion(FORMAT_VERSION)).not.toThrow();
    expect(() => assertSupportedFormatVersion(FORMAT_VERSION + 1)).toThrow(/upgrade looper/);
  });
});
