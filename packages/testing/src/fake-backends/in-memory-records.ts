import type { RunRecord } from '@looper/core';
import type { RunRecordStore } from '@looper/runtime';

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
