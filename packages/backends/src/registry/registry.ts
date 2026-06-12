import type { ExecutionBackend, GitHubPort } from '@looper/core';
import { ClaudeBackend } from '../claude/claude-backend.js';
import { CodexBackend } from '../codex/codex-backend.js';
import { SelfHostedBackend } from '../self-hosted/self-hosted-backend.js';

/**
 * The backend registry (task 0023): a small FIXED map — no plugin loader, no
 * marketplace (codebase guardrail). Third parties use the conformance kit.
 */
export interface RegistryOptions {
  gh: GitHubPort;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  selfHosted?: {
    agent?: 'claude' | 'codex';
    apiKeySecretName?: string;
    defaultBranch?: string;
  };
}

export function createBackendRegistry(
  opts: RegistryOptions,
): ReadonlyMap<string, ExecutionBackend> {
  return new Map<string, ExecutionBackend>([
    [
      'claude',
      new ClaudeBackend({
        gh: opts.gh,
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      }),
    ],
    ['codex', new CodexBackend({ gh: opts.gh })],
    ['self-hosted', new SelfHostedBackend({ gh: opts.gh, ...(opts.selfHosted ?? {}) })],
  ]);
}
