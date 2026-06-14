import type { GitHubPort, RepoRef, RunRecord } from '@loopdog/core';
import { runRecordPath } from '@loopdog/core';

/** Where run records go (0053 owns the store decision; 0012 emits into it). */
export interface RunRecordStore {
  append(record: RunRecord): Promise<void>;
  /** Records for a day bucket (ISO date). Used by the CLI (0069) + telemetry. */
  readDay(date: string): Promise<RunRecord[]>;
}

export const TELEMETRY_BRANCH = 'loopdog/telemetry';

/**
 * The production store (0053): append-only, day-bucketed NDJSON
 * (`runs/YYYY-MM-DD.ndjson`) on the dedicated orphan branch
 * `loopdog/telemetry`, written via the contents API with optimistic
 * concurrency (re-read + retry on a lost write race).
 */
export class TelemetryBranchStore implements RunRecordStore {
  /** Memoized set of day-bucket dates (`YYYY-MM-DD`) that actually have a
   * `runs/*.ndjson` file. One `runs/` listing replaces a per-day 404 storm when
   * a fresh/sparse repo reads the whole budget window (every loop's preflight,
   * plus `status`/`runs`/`bench`). Empty set ⇒ no telemetry branch yet. */
  private days: Set<string> | undefined;

  constructor(
    private readonly gh: GitHubPort,
    private readonly repo: RepoRef,
    private readonly maxRetries = 3,
    /** Egress scrubber (0031): run records are GitHub-visible artifacts. */
    private readonly scrub: (text: string) => string = (text) => text,
  ) {}

  async append(record: RunRecord): Promise<void> {
    await this.gh.ensureBranch(this.repo, TELEMETRY_BRANCH, { orphan: true });
    this.days?.add(record.trigger.at.slice(0, 10)); // keep the bucket cache consistent
    const path = runRecordPath(record.trigger.at);
    const line = this.scrub(JSON.stringify(record));
    for (let attempt = 0; ; attempt++) {
      const existing = await this.gh.readFile(this.repo, TELEMETRY_BRANCH, path);
      const content = existing ? `${existing.content.replace(/\n$/, '')}\n${line}\n` : `${line}\n`;
      try {
        await this.gh.writeFile(
          this.repo,
          TELEMETRY_BRANCH,
          path,
          content,
          `loopdog: run record ${record.runId}`,
          existing?.sha,
        );
        return;
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        // lost an append race — re-read and retry
      }
    }
  }

  async readDay(date: string): Promise<RunRecord[]> {
    if (this.days === undefined) this.days = await this.listDays();
    if (!this.days.has(date)) return []; // no bucket for this day — skip the API call
    const file = await this.gh.readFile(this.repo, TELEMETRY_BRANCH, `runs/${date}.ndjson`);
    if (!file) return [];
    return file.content
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as RunRecord);
  }

  /** One `runs/` listing → the set of day buckets present. `listDir` returns
   * `[]` for a missing branch/dir, so a fresh repo costs a single call. */
  private async listDays(): Promise<Set<string>> {
    const names = await this.gh.listDir(this.repo, TELEMETRY_BRANCH, 'runs');
    return new Set(
      names.map((n) => n.replace(/\.ndjson$/, '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    );
  }
}
