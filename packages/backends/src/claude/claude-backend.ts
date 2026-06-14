import type {
  BackendCapabilities,
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  IngestResult,
  WorkBrief,
} from '@loopdog/core';
import { ingestViaCorrelation } from '../correlation/correlate.js';

/**
 * The Claude subscription backend (task 0020): dispatch by POSTing the
 * composed brief to an imported routine `/fire` URL with its per-routine
 * bearer token — the user's subscription, never `ANTHROPIC_API_KEY`, never the
 * Claude Code GitHub Action. Bootstrap is MANUAL routine import (M00/0093
 * decision); this code never creates routines or tokens.
 */

/** The dated beta header — pinned, surfaced as a known breakage point. */
export const CLAUDE_ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';

/** api.anthropic.com rejects any request without an explicit version header. */
export const CLAUDE_API_VERSION = '2023-06-01';

/** Secret-ref names (env vars injected from Actions secrets by the caller). */
export const CLAUDE_FIRE_URL_REF = 'LOOPDOG_CLAUDE_FIRE_URL';
export const CLAUDE_FIRE_TOKEN_REF = 'LOOPDOG_CLAUDE_FIRE_TOKEN';

export interface ClaudeBackendOptions {
  gh: GitHubPort;
  /** Lazily-resolved secret refs (env names) — never plaintext in config. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class ClaudeBackend implements ExecutionBackend {
  readonly id = 'claude';
  constructor(private readonly opts: ClaudeBackendOptions) {}

  capabilities(): BackendCapabilities {
    return {
      triggerModes: ['api_fire'],
      runsSandbox: true,
      secretPhase: 'full',
      network: 'on',
      opensPr: true,
      supportsReview: true,
      // ZDR orgs are excluded from Claude cloud sessions/routines.
      zdrCompatible: false,
      // Daily routine-run caps exist but are account-specific; modeled from
      // observed run records by the quota gate (M12 · 0075).
      throughput: { tasksPerHour: null },
      quotaNote:
        'routine runs draw subscription usage and have a per-account daily cap; ' +
        'past the cap runs are rejected until the window resets',
    };
  }

  async dispatch(brief: WorkBrief): Promise<DispatchHandle> {
    const env = this.opts.env ?? process.env;
    const fireUrl = env[CLAUDE_FIRE_URL_REF];
    const token = env[CLAUDE_FIRE_TOKEN_REF];
    if (!fireUrl || !token) {
      throw new Error(
        `claude backend: missing ${CLAUDE_FIRE_URL_REF}/${CLAUDE_FIRE_TOKEN_REF} secret refs — ` +
          'run `loopdog connect claude` to import the routine fire URL + token ' +
          '(ZDR orgs cannot use Claude routines; use `loopdog connect default self-hosted`)',
      );
    }

    const doFetch = this.opts.fetchImpl ?? fetch;
    const response = await doFetch(fireUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'anthropic-version': CLAUDE_API_VERSION,
        'anthropic-beta': CLAUDE_ROUTINE_BETA,
      },
      body: JSON.stringify({ text: brief.instructions }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(formatFireError(response.status, detail));
    }
    const data = (await response.json().catch(() => ({}))) as {
      session_id?: string;
      session_url?: string;
      id?: string;
      url?: string;
    };
    const sessionId = data.session_id ?? data.id ?? 'unknown-session';

    return {
      runId: brief.runId,
      backend: this.id,
      item: brief.item,
      dispatchedAt: (this.opts.now?.() ?? new Date()).toISOString(),
      expectedBranch: brief.expectedBranch,
      expectedTrailer: brief.expectedTrailer,
      expectation: brief.expectation,
      signal: {
        kind: 'claude-session',
        sessionId,
        sessionUrl: data.session_url ?? data.url,
      },
    };
  }

  async ingest(handle: DispatchHandle): Promise<IngestResult> {
    return ingestViaCorrelation(this.opts.gh, handle);
  }
}

/**
 * Turn a /fire HTTP failure into an actionable, single-line message. Anthropic
 * returns `{error:{reason,message}}`; we map the known reasons to the fix the
 * adopter must make (which loopdog can't make for them) instead of leaking a
 * raw HTTP status. Falls back to the trimmed body for anything unrecognized.
 */
export function formatFireError(status: number, body: string): string {
  let reason = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { reason?: string; message?: string } };
    reason = parsed.error?.reason ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    // non-JSON body — fall through to the raw-detail path
  }
  const base = `claude /fire failed: HTTP ${status}`;
  switch (reason) {
    case 'github_repo_access_denied':
      return (
        `${base} — the Claude routine can't access this repo. Re-authorize GitHub ` +
        `in Claude (Settings → connected GitHub, or the routine's repository field) ` +
        `and grant the Anthropic GitHub App access to this repository, then retry.`
      );
    case 'authentication_error':
      return (
        `${base} — the routine bearer token is invalid or revoked. Regenerate it in ` +
        `Claude and re-run \`loopdog connect claude --rotate\`.`
      );
    default:
      break;
  }
  if (status === 429) {
    return `${base} — routine quota reached (per-account daily cap); backing off, never retry-storming.${message ? ` ${message}` : ''}`;
  }
  const detail = message || body.slice(0, 200);
  return `${base}${detail ? ` — ${detail}` : ''}`;
}
