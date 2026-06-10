// Syncs task Status from .agent/tasks/*.md (source of truth) into:
//   - .agent/plan-index.md            (| ID | Status | Branch | Title |)
//   - .agent/milestones.md            (| ID | Milestone | Status | Branch | Title |)
//   - .agent/milestones/milestone-*.md (| ID | Status | Branch | Title | Primary Deliverable |)
// Usage: node scripts/sync-plan-index.mjs [--check]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const agentDir = join(root, '.agent');
const check = process.argv.includes('--check');

const statuses = new Map();
for (const f of readdirSync(join(agentDir, 'tasks'))) {
  const m = f.match(/^(\d{4})-.*\.md$/);
  if (!m) continue;
  const text = readFileSync(join(agentDir, 'tasks', f), 'utf8');
  const s = text.match(/^Status:\s*(\S+)\s*$/m);
  if (!s) {
    console.error(`no Status line in tasks/${f}`);
    process.exit(1);
  }
  statuses.set(m[1], s[1]);
}

let changed = 0;
function syncFile(path, statusCol) {
  const before = readFileSync(path, 'utf8');
  const after = before
    .split('\n')
    .map((line) => {
      const cells = line.split('|');
      // table row: '' , col1, col2, ..., ''
      if (cells.length < statusCol + 2) return line;
      const id = cells[1]?.trim();
      if (!/^\d{4}$/.test(id ?? '')) return line;
      const want = statuses.get(id);
      if (!want) return line;
      const cur = cells[statusCol]?.trim();
      if (cur === want) return line;
      cells[statusCol] = ` ${want} `;
      changed++;
      return cells.join('|');
    })
    .join('\n');
  if (after !== before) {
    if (check) {
      console.error(`stale statuses in ${path.slice(root.length)}`);
      process.exitCode = 1;
    } else {
      writeFileSync(path, after);
    }
  }
}

syncFile(join(agentDir, 'plan-index.md'), 2);
syncFile(join(agentDir, 'milestones.md'), 3);
for (const f of readdirSync(join(agentDir, 'milestones'))) {
  if (f.startsWith('milestone-') && f.endsWith('.md')) {
    syncFile(join(agentDir, 'milestones', f), 2);
  }
}

console.log(check ? 'index check done' : `synced ${changed} row(s) from ${statuses.size} task files`);
