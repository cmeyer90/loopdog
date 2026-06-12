import type { BackendId } from '../ports/backend.js';
import type { ItemRef } from '../ports/types.js';
import type { Mode, PlannedAction } from '../gates/mode.js';

/**
 * The run record (task 0012's schema): one per transition attempt, consumed by
 * the CLI (0069) and telemetry/routing (M12/M13). Persistence is owned by 0053:
 * append-only day-bucketed NDJSON (`runs/YYYY-MM-DD.ndjson`) on the dedicated
 * orphan branch `looper/telemetry`, written via the contents API.
 */
export interface RunRecord {
  runId: string;
  loop: string;
  item: ItemRef;
  trigger: { kind: 'event' | 'cron'; event?: string | undefined; at: string };
  backend: BackendId;
  /** `<loop>/prompt.md@<sha8>` + the composed brief snapshot reference. */
  briefRef?: string | undefined;
  /** The mode the run executed under (0009). */
  mode?: Mode | undefined;
  /** What looper did (act) or would have done (dry-run/suggest) — 0009. */
  planned?: PlannedAction[] | undefined;
  steps: RunStep[];
  outcome: RunOutcome;
  cost: RunCost;
}

export interface RunStep {
  t: string;
  kind: 'claim' | 'compose' | 'dispatch' | 'ingest' | 'gate' | 'write' | 'release';
  detail: string;
}

export interface RunOutcome {
  status: 'done' | 'failed' | 'escalated' | 'skipped' | 'parked' | 'pending';
  /** `from->to` when a transition was applied. */
  transition?: string | undefined;
  artifacts?:
    | {
        pr?: number | undefined;
        plan?: string | undefined;
        ghRun?: string | undefined;
        session?: string | undefined;
      }
    | undefined;
  /** Failure classification (M19 taxonomy) when status is failed/escalated. */
  failure?: { class: FailureClass; reason: string } | undefined;
}

export type FailureClass = 'transient' | 'terminal' | 'poisoned' | 'overload' | 'budget';

export interface RunCost {
  tokens?: number | undefined;
  routineRuns?: number | undefined;
  cloudTasks?: number | undefined;
  usd?: number | undefined;
}

/** Stable run id from (loop, item, attempt) — task 0012. */
export function deriveRunId(loop: string, item: ItemRef, attempt: number): string {
  return `run-${loop}-${item.number}-a${attempt}-${fnv1a(`${item.owner}/${item.repo}#${item.number}`)}`;
}

/**
 * The idempotency key (task 0012): one in-flight transition per
 * (loop, item, from-state). Re-running with the same key is a no-op.
 */
export function idempotencyKey(loop: string, item: ItemRef, fromState: string): string {
  return `${loop}:${item.owner}/${item.repo}#${item.number}:${fromState}`;
}

/** Day bucket path for the run-record store (0053). */
export function runRecordPath(at: string): string {
  return `runs/${at.slice(0, 10)}.ndjson`;
}

/** Tiny deterministic hash (FNV-1a, 32-bit) — stable ids without crypto deps. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
