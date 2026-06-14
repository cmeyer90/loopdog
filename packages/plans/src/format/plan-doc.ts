import type { PlanStatus } from '@loopdog/core';

/**
 * The portable plan format (task 0015): parse/serialize for the markdown
 * milestone+task shape, designed for LOSSLESS machine edits — mutate one
 * block, re-serialize, and every other byte survives.
 */

export interface PlanDoc {
  kind: 'task' | 'milestone';
  /** `0042` for tasks, `04` for milestones. */
  id: string;
  title: string;
  status: PlanStatus | string;
  /** Raw lines between the heading and the first `## ` section (Status/Branch/Issue…). */
  headerLines: string[];
  /** Ordered sections; body keeps its exact raw text. */
  sections: Array<{ heading: string; body: string }>;
}

export function parsePlan(markdown: string): PlanDoc {
  const lines = markdown.split('\n');
  const headingLine = lines[0] ?? '';
  const task = headingLine.match(/^# (\d{4}) (.*)$/);
  const milestone = headingLine.match(/^# Milestone (\d{2}): (.*)$/);
  const kind: PlanDoc['kind'] = milestone ? 'milestone' : 'task';
  const id = (task?.[1] ?? milestone?.[1] ?? '').trim();
  const title = (task?.[2] ?? milestone?.[2] ?? headingLine.replace(/^#+\s*/, '')).trim();

  const headerLines: string[] = [];
  const sections: PlanDoc['sections'] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n') });
      current = { heading: line.slice(3).trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      headerLines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n') });

  const statusLine = headerLines.find((l) => l.startsWith('Status:'));
  const status = statusLine ? statusLine.replace(/^Status:\s*/, '').trim() : 'planned';
  return { kind, id, title, status, headerLines, sections };
}

export function serializePlan(doc: PlanDoc): string {
  const heading =
    doc.kind === 'milestone' ? `# Milestone ${doc.id}: ${doc.title}` : `# ${doc.id} ${doc.title}`;
  const parts = [heading, ...doc.headerLines];
  for (const section of doc.sections) {
    parts.push(`## ${section.heading}`);
    parts.push(section.body);
  }
  return parts.join('\n');
}

// ---- mutators (each touches exactly one block) ----

export function setStatus(doc: PlanDoc, status: PlanStatus | string): PlanDoc {
  const headerLines = doc.headerLines.map((line) => {
    if (!line.startsWith('Status:')) return line;
    // preserve trailing markers (e.g. two-space markdown line break)
    const trailer = line.endsWith('  ') ? '  ' : '';
    return `Status: ${status}${trailer}`;
  });
  return { ...doc, status, headerLines };
}

export function getSection(doc: PlanDoc, heading: string): string | null {
  return doc.sections.find((s) => s.heading === heading)?.body ?? null;
}

export function updateSection(doc: PlanDoc, heading: string, body: string): PlanDoc {
  const sections = doc.sections.map((s) => (s.heading === heading ? { ...s, body } : s));
  return { ...doc, sections };
}

/** Append a line to a section (creates the section at the end when missing). */
export function appendToSection(doc: PlanDoc, heading: string, line: string): PlanDoc {
  const existing = doc.sections.find((s) => s.heading === heading);
  if (!existing) {
    return { ...doc, sections: [...doc.sections, { heading, body: `\n${line}\n` }] };
  }
  const body = existing.body.replace(/\n*$/, '') + `\n${line}\n`;
  return updateSection(doc, heading, body);
}

/** Check a `- [ ]` item whose text contains the needle, in one section only. */
export function checkItem(doc: PlanDoc, heading: string, needle: string): PlanDoc {
  const body = getSection(doc, heading);
  if (body === null) return doc;
  const updated = body
    .split('\n')
    .map((line) =>
      line.includes(needle) && /^(\s*)- \[ \]/.test(line) ? line.replace('- [ ]', '- [x]') : line,
    )
    .join('\n');
  return updateSection(doc, heading, updated);
}

/** Header field access (e.g. `Issue: #142`, `Branch: …`). */
export function getHeaderField(doc: PlanDoc, name: string): string | null {
  const line = doc.headerLines.find((l) => l.startsWith(`${name}:`));
  return line ? line.replace(new RegExp(`^${name}:\\s*`), '').replace(/\s+$/, '') : null;
}

export function setHeaderField(doc: PlanDoc, name: string, value: string): PlanDoc {
  const exists = doc.headerLines.some((l) => l.startsWith(`${name}:`));
  if (exists) {
    const headerLines = doc.headerLines.map((line) => {
      if (!line.startsWith(`${name}:`)) return line;
      const trailer = line.endsWith('  ') ? '  ' : '';
      return `${name}: ${value}${trailer}`;
    });
    return { ...doc, headerLines };
  }
  // insert after the last existing field line (Status/Branch block)
  const idx = findLastFieldIndex(doc.headerLines);
  const headerLines = [...doc.headerLines];
  headerLines.splice(idx + 1, 0, `${name}: ${value}  `);
  return { ...doc, headerLines };
}

function findLastFieldIndex(lines: string[]): number {
  let last = 0;
  lines.forEach((line, i) => {
    if (/^[A-Z][A-Za-z ]*:/.test(line)) last = i;
  });
  return last;
}
