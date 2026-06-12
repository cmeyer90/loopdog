import type { GitHubPort, RepoRef, RunRecord } from '@looper/core';
import { runRecordPath } from '@looper/core';

/** Where run records go (0053 owns the store decision; 0012 emits into it). */
export interface RunRecordStore {
  append(record: RunRecord): Promise<void>;
  /** Records for a day bucket (ISO date). Used by the CLI (0069) + telemetry. */
  readDay(date: string): Promise<RunRecord[]>;
}

export const TELEMETRY_BRANCH = 'looper/telemetry';

/**
 * The production store (0053): append-only, day-bucketed NDJSON
 * (`runs/YYYY-MM-DD.ndjson`) on the dedicated orphan branch
 * `looper/telemetry`, written via the contents API with optimistic
 * concurrency (re-read + retry on a lost write race).
 */
export class TelemetryBranchStore implements RunRecordStore {
  constructor(
    private readonly gh: GitHubPort,
    private readonly repo: RepoRef,
    private readonly maxRetries = 3,
  ) {}

  async append(record: RunRecord): Promise<void> {
    await this.gh.ensureBranch(this.repo, TELEMETRY_BRANCH, { orphan: true });
    const path = runRecordPath(record.trigger.at);
    const line = JSON.stringify(record);
    for (let attempt = 0; ; attempt++) {
      const existing = await this.gh.readFile(this.repo, TELEMETRY_BRANCH, path);
      const content = existing ? `${existing.content.replace(/\n$/, '')}\n${line}\n` : `${line}\n`;
      try {
        await this.gh.writeFile(
          this.repo,
          TELEMETRY_BRANCH,
          path,
          content,
          `looper: run record ${record.runId}`,
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
    const file = await this.gh.readFile(this.repo, TELEMETRY_BRANCH, `runs/${date}.ndjson`);
    if (!file) return [];
    return file.content
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as RunRecord);
  }
}
