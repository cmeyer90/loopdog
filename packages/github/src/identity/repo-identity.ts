/**
 * Loopdog's repo identity (task 0029): WHO loopdog acts as on GitHub, resolved
 * from the runtime environment. Preference: explicit PAT (instant handoff) →
 * Actions GITHUB_TOKEN (the keyless default) → the CLI's stored token.
 * The token value is carried but never logged/serialized.
 */

export type TokenSource = 'pat' | 'actions' | 'cli-device' | 'cli-gh';

export interface RepoIdentity {
  /** Never logged; redacted everywhere by construction. */
  token: string;
  source: TokenSource;
  login: string;
  isBot: boolean;
  /** false on fork-PR GITHUB_TOKEN (read-only) — writes defer to the sweep. */
  writable: boolean;
  /** false exactly for 'actions': controller writes won't re-trigger workflows. */
  reTriggersWorkflows: boolean;
}

export interface IdentityContext {
  env?: NodeJS.ProcessEnv;
  /** The triggering event payload (fork detection), when in Actions. */
  eventPayload?: Record<string, unknown> | undefined;
  /** The CLI's stored/gh token, when running locally (0077). */
  cliToken?: { token: string; source: 'cli-device' | 'cli-gh' } | undefined;
}

export function resolveRepoIdentity(ctx: IdentityContext = {}): RepoIdentity {
  const env = ctx.env ?? process.env;

  if (env['LOOPDOG_PAT']) {
    return {
      token: env['LOOPDOG_PAT'],
      source: 'pat',
      login: env['GITHUB_ACTOR'] ?? 'pat-user',
      isBot: false,
      writable: true,
      reTriggersWorkflows: true,
    };
  }

  if (env['GITHUB_TOKEN']) {
    return {
      token: env['GITHUB_TOKEN'],
      source: 'actions',
      login: 'github-actions[bot]',
      isBot: true,
      writable: !isForkPullRequest(ctx.eventPayload),
      reTriggersWorkflows: false,
    };
  }

  if (ctx.cliToken) {
    return {
      token: ctx.cliToken.token,
      source: ctx.cliToken.source,
      login: env['GITHUB_ACTOR'] ?? 'cli-user',
      isBot: false,
      writable: true,
      reTriggersWorkflows: true,
    };
  }

  throw new Error(
    'no GitHub identity: set GITHUB_TOKEN (CI), LOOPDOG_PAT, or login locally ' +
      '(`gh auth login` / `loopdog login`)',
  );
}

/** Fork-originated pull_request events get a READ-ONLY GITHUB_TOKEN. */
export function isForkPullRequest(payload: Record<string, unknown> | undefined): boolean {
  const pr = payload?.['pull_request'] as
    | { head?: { repo?: { fork?: boolean; full_name?: string } } }
    | undefined;
  const repo = payload?.['repository'] as { full_name?: string } | undefined;
  const head = pr?.head?.repo;
  if (!head) return false;
  if (head.fork === true && head.full_name !== repo?.full_name) return true;
  return head.full_name !== undefined && repo?.full_name !== undefined
    ? head.full_name !== repo.full_name
    : false;
}

/**
 * The handoff matrix (0029, documented + table-tested): does a state change
 * made by this identity fire follow-on event workflows, or must the sweep
 * carry it?
 */
export function handoffMode(
  identity: Pick<RepoIdentity, 'reTriggersWorkflows'>,
): 'instant' | 'sweep' {
  return identity.reTriggersWorkflows ? 'instant' : 'sweep';
}
