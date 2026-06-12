import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  IngestResult,
  WorkBrief,
} from '@looper/core';
import { ingestViaCorrelation } from '../correlation/correlate.js';

/**
 * The self-hosted / API backend (task 0074) — the confirmed SECONDARY: the
 * adopter runs the work cell on their own compute with their own model API
 * key, recovering live secrets + network + ZDR compatibility. Dispatch
 * triggers the adopter-owned worker workflow; the API key is referenced only
 * as a secret NAME and resolved inside the worker job — never here, never
 * logged.
 */

export const SELF_HOSTED_WORKER_WORKFLOW = 'looper-self-hosted-worker.yml';
export const DEFAULT_API_KEY_SECRET = 'LOOPER_MODEL_API_KEY';

export interface SelfHostedBackendOptions {
  gh: GitHubPort;
  /** Which agent CLI the worker runs. */
  agent?: 'claude' | 'codex';
  /** The adopter's secret NAME holding the model API key (never a value). */
  apiKeySecretName?: string;
  defaultBranch?: string;
  now?: () => Date;
}

export class SelfHostedBackend implements ExecutionBackend {
  readonly id = 'self-hosted';
  constructor(private readonly opts: SelfHostedBackendOptions) {}

  capabilities(): BackendCapabilities {
    return {
      triggerModes: ['self_hosted_dispatch'],
      runsSandbox: true, // the adopter's own runner/container IS the sandbox
      secretPhase: 'full', // live secrets the whole run (recovered)
      network: 'on', // full network during the work cell (recovered)
      opensPr: true,
      supportsReview: true,
      zdrCompatible: true, // the differentiator: nothing leaves adopter compute
      throughput: { tasksPerHour: null }, // no provider cap
      quotaNote: 'no provider cap — pay-per-token on the adopter’s own API key',
    };
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    const repo = { owner: brief.item.owner, repo: brief.item.repo };
    const dispatchedAt = (this.opts.now?.() ?? new Date()).toISOString();
    await this.opts.gh.dispatchWorkflow(
      repo,
      SELF_HOSTED_WORKER_WORKFLOW,
      this.opts.defaultBranch ?? 'main',
      {
        run_id: brief.runId,
        loop: brief.loop,
        issue: String(brief.item.number),
        branch: brief.expectedBranch,
        trailer: brief.expectedTrailer,
        agent: this.opts.agent ?? 'claude',
        api_key_secret: this.opts.apiKeySecretName ?? DEFAULT_API_KEY_SECRET,
        brief: brief.instructions,
      },
    );
    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt,
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: { kind: 'workflow-run', workflowFile: SELF_HOSTED_WORKER_WORKFLOW, dispatchedAt },
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    return ingestViaCorrelation(this.opts.gh, handle);
  }
}

/**
 * Agent-CLI command builder for the worker job (pure; the worker template
 * executes it). Isolated so a CLI flag drift is a one-place fix.
 */
export function agentCommand(agent: 'claude' | 'codex', briefFile: string): string[] {
  switch (agent) {
    case 'claude':
      // headless print mode; the brief is the prompt
      return ['claude', '-p', `"$(cat ${briefFile})"`, '--permission-mode', 'acceptEdits'];
    case 'codex':
      return ['codex', 'exec', '--full-auto', `"$(cat ${briefFile})"`];
  }
}
