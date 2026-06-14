/**
 * Loopdog's repo identity (M07 · 0029): in CI the controller is the workflow's
 * `GITHUB_TOKEN` — keyless, auto-scoped, no loopdog GitHub App. Locally it is
 * the user's `gh` auth or a token env var. An optional `LOOPDOG_PAT` overrides
 * everything (task 0105): its writes re-trigger event workflows, so loop→loop
 * handoffs are instant instead of sweep-carried. This precedence MUST match
 * `resolveRepoIdentity` (repo-identity.ts) — that function decides
 * `reTriggersWorkflows`, and this one picks the token the API client actually
 * uses; if they disagree the controller would believe handoffs cascade while
 * writing as a non-cascading identity. This module only RESOLVES tokens; it
 * never persists them anywhere model-visible.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ResolvedAuth {
  token: string;
  source: 'env:LOOPDOG_PAT' | 'env:GITHUB_TOKEN' | 'env:GH_TOKEN' | 'gh-cli';
}

export async function resolveGitHubAuth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedAuth> {
  // Highest precedence, mirroring resolveRepoIdentity: an explicit PAT buys
  // instant handoff. Empty (unset workflow secret) is falsy → falls through.
  if (env['LOOPDOG_PAT']) return { token: env['LOOPDOG_PAT'], source: 'env:LOOPDOG_PAT' };
  if (env['GITHUB_TOKEN']) return { token: env['GITHUB_TOKEN'], source: 'env:GITHUB_TOKEN' };
  if (env['GH_TOKEN']) return { token: env['GH_TOKEN'], source: 'env:GH_TOKEN' };
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token) return { token, source: 'gh-cli' };
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'no GitHub auth: set GITHUB_TOKEN (CI) or GH_TOKEN, or login with `gh auth login` / `loopdog login`',
  );
}

/** The actor the Actions `GITHUB_TOKEN` acts as. */
export const ACTIONS_BOT = { login: 'github-actions[bot]', type: 'Bot' as const };

/** Parse `owner/name` from common git remote URL shapes. */
export function parseRepoFromRemoteUrl(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!m || !m[1] || !m[2]) return null;
  return { owner: m[1], repo: m[2] };
}
