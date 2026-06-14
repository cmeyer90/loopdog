import type { ItemRef, PullRequestSnapshot } from './types.js';

/**
 * The execution-backend port (tasks 0019/0094): `dispatch(brief) → ingest(result)`.
 * Implemented by `@loopdog/backends` for Claude (routine /fire), Codex (@codex
 * mention), and the self-hosted runner; faked by `@loopdog/testing` (0084).
 * The controller composes the brief and gates the result; the backend's cloud
 * agent does the model work. Loopdog makes no direct model API calls here.
 */
export interface ExecutionBackend {
  readonly id: BackendId;
  capabilities(): BackendCapabilities;
  /**
   * Fire the work cell. Must record a **dispatch-time correlation signal**
   * (0093 decision: the non-agent-dependent signal is authoritative) in the
   * returned handle before returning.
   */
  dispatch(brief: WorkBrief): Promise<DispatchHandle>;
  /**
   * Look for the work cell's result (typically a PR) using the handle's
   * correlation signals. Non-blocking: returns `pending` until found or timed
   * out by policy (M19 owns the timeout decision, not the backend).
   */
  ingest(handle: DispatchHandle): Promise<IngestResult>;
}

/** Well-known backend ids; custom backends may use other strings. */
export type BackendId = 'claude' | 'codex' | 'self-hosted' | (string & {});

export interface BackendCapabilities {
  /** How this backend is invoked (0019). */
  triggerModes: Array<'api_fire' | 'mention' | 'github_event' | 'self_hosted_dispatch'>;
  /** Does the backend host a sandbox that can run the project's tests? */
  runsSandbox: boolean;
  /** When secrets are available in that sandbox (Codex strips before agent phase). */
  secretPhase: 'full' | 'setup-only' | 'none';
  /** Network availability during the agent phase. */
  network: 'on' | 'setup-only' | 'off';
  opensPr: boolean;
  supportsReview: boolean;
  /** Can a Zero-Data-Retention org use this backend? */
  zdrCompatible: boolean;
  /** Provider rate cap; null = no provider cap (bounded only by resilience). */
  throughput: { tasksPerHour: number | null };
  /** Honest quota note shown by the CLI (e.g. "~5 cloud tasks/hr on lower tiers"). */
  quotaNote: string;
}

/** The composed, versioned brief the controller sends to a work cell. */
export interface WorkBrief {
  runId: string;
  loop: string;
  item: ItemRef;
  /** `<loop>/prompt.md@<sha8>` — the versioned prompt artifact reference (0022). */
  briefRef: string;
  /** The fully-composed instruction text (prompt artifact + item context + contract). */
  instructions: string;
  /** Branch the agent is asked to create — `loopdog/<loop>/<issue>-<runId>`. */
  expectedBranch: string;
  /** Trailer the agent is asked to put in the PR body — `loopdog-run: <runId>`. */
  expectedTrailer: string;
  /** What the work cell is expected to produce. */
  expectation: 'pull-request' | 'comment' | 'plan-update';
}

/** Recorded at dispatch; everything ingest needs to find the result later. */
export interface DispatchHandle {
  runId: string;
  backend: BackendId;
  item: ItemRef;
  dispatchedAt: string;
  expectedBranch: string;
  expectedTrailer: string;
  expectation: WorkBrief['expectation'];
  /** The authoritative, non-agent-dependent signal (0093 decision). */
  signal: CorrelationSignal;
}

export type CorrelationSignal =
  | { kind: 'claude-session'; sessionId: string; sessionUrl?: string | undefined }
  | { kind: 'codex-mention'; commentId: number; mentionedAt: string }
  | { kind: 'workflow-run'; workflowFile: string; dispatchedAt: string }
  | { kind: 'local-process'; pid?: number | undefined; startedAt: string };

export type IngestResult =
  | { status: 'pending' }
  | {
      status: 'completed';
      pr?: PullRequestSnapshot | undefined;
      commentId?: number | undefined;
      /** Which signal matched — telemetry for the 0093 honor-rate question. */
      matchedBy: 'dispatch-signal' | 'branch-name' | 'pr-trailer' | 'issue-ref';
    }
  | { status: 'failed'; reason: string };
