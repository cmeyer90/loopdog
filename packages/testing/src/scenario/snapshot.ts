import { createHash } from 'node:crypto';
import type { RunRecord } from '@loopdog/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';
import type { InMemoryRunRecordStore } from '../fake-backends/in-memory-records.js';

/**
 * Golden snapshot (task 0085): serialize end-state — labels, PRs, comments,
 * plan files, run-records — into a stable, redacted, deterministically-ordered
 * artifact so whole loops are provable end-to-end and any drift fails CI.
 *
 * Determinism/redaction rules: (a) ids/timestamps come from the seeded fake
 * (0083) + injected clock (0086), so they're already stable — no churn; (b)
 * free-text (comment/PR/plan prose) reduces to a sha256 digest so goldens
 * assert *structure + which content*, not brittle wording; (c) collections are
 * sorted by stable key; (d) volatile fields (durations, tokens) are dropped.
 */
export interface Golden {
  /** item number → sorted loopdog:* labels (state + operational). */
  labels: Record<string, string[]>;
  prs: Array<{
    number: number;
    head: string;
    base: string;
    state: string;
    merged: boolean;
    linksIssue?: number;
  }>;
  comments: Array<{ target: string; author: string; bodyDigest: string }>;
  /** plan file path → sha256 of its content. */
  plan: Record<string, string>;
  runs: Array<{
    runId: string;
    loop: string;
    item: number;
    status: string;
    transition: string;
    steps: string[];
  }>;
}

const digest = (text: string): string =>
  'sha256:' + createHash('sha256').update(text).digest('hex').slice(0, 16);

const loopdogLabels = (labels: string[]): string[] =>
  labels.filter((l) => l.startsWith('loopdog:')).sort();

export function snapshotGolden(
  gh: FakeGitHub,
  records: InMemoryRunRecordStore,
  repo: { owner: string; repo: string },
): Golden {
  const all = gh.dump();
  const inRepo = <T extends { ref: { owner: string; repo: string } }>(x: T): boolean =>
    x.ref.owner === repo.owner && x.ref.repo === repo.repo;

  const labels: Record<string, string[]> = {};
  for (const i of [...all.issues, ...all.pulls]
    .filter(inRepo)
    .sort((a, b) => a.ref.number - b.ref.number)) {
    const ll = loopdogLabels(i.labels);
    if (ll.length > 0) labels[String(i.ref.number)] = ll;
  }

  const prs = all.pulls
    .filter(inRepo)
    .map((p) => {
      const linksIssue = p.body.match(/#(\d+)/)?.[1];
      return {
        number: p.ref.number,
        head: p.headRef,
        base: p.baseRef,
        state: p.state,
        merged: p.merged,
        ...(linksIssue ? { linksIssue: Number(linksIssue) } : {}),
      };
    })
    .sort((a, b) => a.number - b.number);

  const comments = all.comments
    .flatMap((c) =>
      c.bodies.map((body) => ({
        target: `#${c.item}`,
        author: 'loopdog',
        bodyDigest: digest(body),
      })),
    )
    .sort((a, b) => a.target.localeCompare(b.target) || a.bodyDigest.localeCompare(b.bodyDigest));

  const plan: Record<string, string> = {};
  for (const f of all.files
    .filter((f) => /\/(tasks|plans)\/.*\.md$/.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))) {
    plan[f.path] = digest(f.content);
  }

  const runs = records.records
    .filter((r) => r.item.owner === repo.owner && r.item.repo === repo.repo)
    .map((r: RunRecord) => ({
      runId: r.runId,
      loop: r.loop,
      item: r.item.number,
      status: r.outcome.status,
      transition: r.outcome.transition ?? '',
      steps: r.steps.map((s) => s.kind),
    }))
    .sort((a, b) => a.runId.localeCompare(b.runId));

  return { labels, prs, comments, plan, runs };
}

export function goldenJson(g: Golden): string {
  return JSON.stringify(g, null, 2) + '\n';
}

export interface GoldenDiff {
  match: boolean;
  diff?: string;
}

/** Readable line-level diff between two goldens (canonical JSON). */
export function diffGolden(actual: Golden, golden: Golden): GoldenDiff {
  const a = goldenJson(actual);
  const g = goldenJson(golden);
  if (a === g) return { match: true };
  const aLines = a.split('\n');
  const gLines = g.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(aLines.length, gLines.length); i++) {
    if (aLines[i] !== gLines[i]) {
      if (gLines[i] !== undefined) out.push(`- ${gLines[i]}`);
      if (aLines[i] !== undefined) out.push(`+ ${aLines[i]}`);
    }
  }
  return { match: false, diff: out.join('\n') };
}
