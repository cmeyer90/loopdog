import type { GitHubPort, RepoRef } from '@loopdog/core';
import { STORE_LAYOUT } from '../format/templates.js';
import { parsePlan, type PlanDoc } from '../format/plan-doc.js';

/**
 * File primitives for the durable plan store (M04): plain markdown in the
 * target repo at the configurable `plan_store.path`, written through the
 * GitHub contents API (the controller's GITHUB_TOKEN identity). The plan files
 * are the truth; everything else (indexes) is a projection.
 */
export class RepoPlanStoreFiles {
  constructor(
    private readonly gh: GitHubPort,
    private readonly repo: RepoRef,
    private readonly branch: string,
    /** Store root, e.g. `.loopdog/plans`. */
    readonly root: string,
  ) {}

  path(...parts: string[]): string {
    return [this.root, ...parts].join('/');
  }

  async read(path: string): Promise<{ content: string; sha: string } | null> {
    return this.gh.readFile(this.repo, this.branch, path);
  }

  async write(path: string, content: string, message: string, expectedSha?: string): Promise<void> {
    // Render-then-compare: identical bytes → skip (no empty commits).
    const existing = expectedSha === undefined ? await this.read(path) : null;
    if (existing && existing.content === content) return;
    await this.gh.writeFile(
      this.repo,
      this.branch,
      path,
      content,
      message,
      expectedSha ?? existing?.sha,
    );
  }

  async list(dir: string): Promise<string[]> {
    return this.gh.listDir(this.repo, this.branch, dir);
  }

  /** Every parseable plan doc in a dir; malformed files are skipped + reported. */
  async readPlans(dir: string): Promise<{ docs: PlanDoc[]; skipped: string[] }> {
    const docs: PlanDoc[] = [];
    const skipped: string[] = [];
    for (const name of await this.list(dir)) {
      if (!name.endsWith('.md')) continue;
      const file = await this.read(`${dir}/${name}`);
      if (!file) continue;
      if (file.content.includes('<!-- loopdog:tombstone -->')) continue; // archived pointer
      const doc = parsePlan(file.content);
      if (doc.id === '') {
        skipped.push(`${dir}/${name}`);
        continue;
      }
      docs.push(doc);
    }
    return { docs, skipped };
  }

  /** Next task id: max over active + archived task ids + 1 (ids never reuse). */
  async nextTaskId(): Promise<string> {
    let max = 0;
    for (const dir of [this.path(STORE_LAYOUT.tasks), this.path(STORE_LAYOUT.archiveTasks)]) {
      for (const name of await this.list(dir)) {
        const m = name.match(/^(\d{4})-/);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return String(max + 1).padStart(4, '0');
  }

  /** Find a task file by id in active then archive; returns its path. */
  async findTaskFile(id: string): Promise<string | null> {
    for (const dir of [this.path(STORE_LAYOUT.tasks), this.path(STORE_LAYOUT.archiveTasks)]) {
      for (const name of await this.list(dir)) {
        if (name.startsWith(`${id}-`)) return `${dir}/${name}`;
      }
    }
    return null;
  }
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}
