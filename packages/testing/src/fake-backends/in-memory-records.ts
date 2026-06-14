import type { RunRecord } from '@loopdog/core';
import type { RunRecordStore } from '@loopdog/runtime';

/** In-memory `RunRecordStore` for tests — no branch IO, just the list. */
export class InMemoryRunRecordStore implements RunRecordStore {
  readonly records: RunRecord[] = [];

  async append(record: RunRecord): Promise<void> {
    this.records.push(record);
  }

  async readDay(date: string): Promise<RunRecord[]> {
    return this.records.filter((r) => r.trigger.at.startsWith(date));
  }
}
