import { describe, expect, it } from 'vitest';
import { handoffMode, isForkPullRequest, resolveRepoIdentity } from '@loopdog/github';

describe('repo identity (0029)', () => {
  it('resolves source precedence: PAT > GITHUB_TOKEN > CLI token', () => {
    const pat = resolveRepoIdentity({
      env: { LOOPDOG_PAT: 'pat-1', GITHUB_TOKEN: 'gha-1' } as NodeJS.ProcessEnv,
    });
    expect(pat).toMatchObject({ source: 'pat', writable: true, reTriggersWorkflows: true });

    const actions = resolveRepoIdentity({ env: { GITHUB_TOKEN: 'gha-1' } as NodeJS.ProcessEnv });
    expect(actions).toMatchObject({
      source: 'actions',
      login: 'github-actions[bot]',
      isBot: true,
      reTriggersWorkflows: false,
    });

    const cli = resolveRepoIdentity({
      env: {} as NodeJS.ProcessEnv,
      cliToken: { token: 't', source: 'cli-gh' },
    });
    expect(cli).toMatchObject({ source: 'cli-gh', reTriggersWorkflows: true });

    expect(() => resolveRepoIdentity({ env: {} as NodeJS.ProcessEnv })).toThrow(/loopdog login/);
  });

  it('handoff matrix: only actions-token edges need the sweep', () => {
    expect(handoffMode({ reTriggersWorkflows: false })).toBe('sweep'); // controller edge
    expect(handoffMode({ reTriggersWorkflows: true })).toBe('instant'); // human/PAT edge
  });

  it('fork-PR events are read-only under GITHUB_TOKEN; a PAT restores writes', () => {
    const forkPayload = {
      pull_request: { head: { repo: { fork: true, full_name: 'fork/r' } } },
      repository: { full_name: 'o/r' },
    };
    const readonly = resolveRepoIdentity({
      env: { GITHUB_TOKEN: 'gha-1' } as NodeJS.ProcessEnv,
      eventPayload: forkPayload,
    });
    expect(readonly.writable).toBe(false);

    const withPat = resolveRepoIdentity({
      env: { LOOPDOG_PAT: 'pat-1' } as NodeJS.ProcessEnv,
      eventPayload: forkPayload,
    });
    expect(withPat.writable).toBe(true);

    const sameRepo = {
      pull_request: { head: { repo: { fork: false, full_name: 'o/r' } } },
      repository: { full_name: 'o/r' },
    };
    expect(isForkPullRequest(sameRepo)).toBe(false);
    expect(isForkPullRequest(undefined)).toBe(false);
  });

  it('never leaks the token through JSON serialization of derived records', () => {
    const identity = resolveRepoIdentity({
      env: { GITHUB_TOKEN: 'gha-SECRET' } as NodeJS.ProcessEnv,
    });
    // the flags consumers persist (run records) never include the token
    const persisted = JSON.stringify({
      writable: identity.writable,
      reTriggersWorkflows: identity.reTriggersWorkflows,
      source: identity.source,
      login: identity.login,
    });
    expect(persisted).not.toContain('gha-SECRET');
  });
});
