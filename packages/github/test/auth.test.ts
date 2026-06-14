import { describe, expect, it } from 'vitest';
import { resolveGitHubAuth } from '@loopdog/github';

// The token resolveGitHubAuth picks (used to build the API client) MUST share
// precedence with resolveRepoIdentity's `reTriggersWorkflows` decision, or the
// controller would think handoffs cascade while writing as a non-cascading
// identity (task 0105).
describe('resolveGitHubAuth precedence (0105)', () => {
  it('prefers LOOPDOG_PAT over GITHUB_TOKEN/GH_TOKEN', async () => {
    const auth = await resolveGitHubAuth({
      LOOPDOG_PAT: 'pat-1',
      GITHUB_TOKEN: 'gha-1',
      GH_TOKEN: 'gh-1',
    } as NodeJS.ProcessEnv);
    expect(auth).toEqual({ token: 'pat-1', source: 'env:LOOPDOG_PAT' });
  });

  it('falls through to GITHUB_TOKEN when LOOPDOG_PAT is empty (unset secret)', async () => {
    const auth = await resolveGitHubAuth({
      LOOPDOG_PAT: '',
      GITHUB_TOKEN: 'gha-1',
    } as NodeJS.ProcessEnv);
    expect(auth).toEqual({ token: 'gha-1', source: 'env:GITHUB_TOKEN' });
  });

  it('still resolves GH_TOKEN when only it is set', async () => {
    const auth = await resolveGitHubAuth({ GH_TOKEN: 'gh-1' } as NodeJS.ProcessEnv);
    expect(auth).toEqual({ token: 'gh-1', source: 'env:GH_TOKEN' });
  });
});
