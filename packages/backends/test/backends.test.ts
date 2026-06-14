import { describe, expect, it, vi } from 'vitest';
import { FakeGitHub } from '@loopdog/testing';
import {
  BackendAuthError,
  ClaudeBackend,
  CodexBackend,
  SelfHostedBackend,
  UnknownBackendError,
  checkCompatibility,
  correlatePr,
  createBackendRegistry,
  deriveStage,
  findCorrelatedPr,
  resolveAuth,
  selectBackend,
} from '@loopdog/backends';
import type { DispatchHandle, WorkBrief } from '@loopdog/core';

const repo = { owner: 'o', repo: 'r' };
const item = { ...repo, number: 7 };

const brief: WorkBrief = {
  runId: 'run-implement-7-a1-abc',
  loop: 'implement',
  item,
  briefRef: 'implement/prompt.md@deadbeef',
  instructions: 'Do the thing.\n\nloopdog-run: run-implement-7-a1-abc',
  expectedBranch: 'loopdog/implement/7-run-implement-7-a1-abc',
  expectedTrailer: 'loopdog-run: run-implement-7-a1-abc',
  expectation: 'pull-request',
};

function handle(partial: Partial<DispatchHandle> = {}): DispatchHandle {
  return {
    runId: brief.runId,
    backend: 'claude',
    item,
    dispatchedAt: '2026-06-09T12:00:00Z',
    expectedBranch: brief.expectedBranch,
    expectedTrailer: brief.expectedTrailer,
    expectation: 'pull-request',
    signal: { kind: 'claude-session', sessionId: 's1' },
    ...partial,
  };
}

describe('correlation (0073)', () => {
  it('matches by branch, then trailer, then issue-ref; unrelated PRs are not ours', () => {
    const base = {
      ref: { ...repo, number: 100 },
      kind: 'pull-request' as const,
      title: 't',
      state: 'open' as const,
      labels: [],
      assignees: [],
      author: { login: 'provider[bot]', type: 'Bot' as const },
      authorAssociation: 'NONE' as const,
      createdAt: '2026-06-09T12:05:00Z',
      updatedAt: '2026-06-09T12:05:00Z',
      baseRef: 'main',
      draft: false,
      merged: false,
      mergeable: true,
      changedFiles: 1,
      additions: 1,
      deletions: 0,
    };
    expect(correlatePr(handle(), { ...base, headRef: brief.expectedBranch, body: '' })).toBe(
      'branch-name',
    );
    expect(
      correlatePr(handle(), {
        ...base,
        headRef: 'agent/freestyle',
        body: `x\n\n${brief.expectedTrailer}`,
      }),
    ).toBe('pr-trailer');
    expect(correlatePr(handle(), { ...base, headRef: 'agent/freestyle', body: 'Fixes #7' })).toBe(
      'issue-ref',
    );
    // human-authored PR referencing the issue is NOT ours
    expect(
      correlatePr(handle(), {
        ...base,
        headRef: 'feature/x',
        body: 'see #7',
        author: { login: 'human', type: 'User' },
      }),
    ).toBeNull();
    // bot PR referencing the issue but opened BEFORE dispatch is not ours
    expect(
      correlatePr(handle(), {
        ...base,
        headRef: 'feature/x',
        body: 'see #7',
        createdAt: '2026-06-09T11:00:00Z',
      }),
    ).toBeNull();
  });

  it('findCorrelatedPr prefers the exact branch and falls back to scanning', async () => {
    const gh = new FakeGitHub();
    gh.seedPull({ ref: { ...repo, number: 100 }, headRef: 'unrelated', body: 'nope' });
    gh.seedPull({
      ref: { ...repo, number: 101 },
      headRef: 'agent/freestyle',
      body: `did it\n\n${brief.expectedTrailer}`,
      createdAt: '2026-06-09T12:10:00Z',
    });
    const fallback = await findCorrelatedPr(gh, handle());
    expect(fallback).toMatchObject({ matchedBy: 'pr-trailer', pr: { ref: { number: 101 } } });

    gh.seedPull({ ref: { ...repo, number: 102 }, headRef: brief.expectedBranch, body: '' });
    const exact = await findCorrelatedPr(gh, handle());
    expect(exact).toMatchObject({ matchedBy: 'branch-name', pr: { ref: { number: 102 } } });
  });
});

describe('claude backend (0020)', () => {
  it('fires the imported routine with the bearer token + beta header; no API key anywhere', async () => {
    const gh = new FakeGitHub();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(
        JSON.stringify({ session_id: 'sess-1', session_url: 'https://claude.ai/s/1' }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;

    const backend = new ClaudeBackend({
      gh,
      env: {
        LOOPDOG_CLAUDE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/rt1/fire',
        LOOPDOG_CLAUDE_FIRE_TOKEN: 'sk-ant-oat01-test',
      } as NodeJS.ProcessEnv,
      fetchImpl,
      now: () => new Date('2026-06-09T12:00:00Z'),
    });

    const h = await backend.dispatch(brief);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/fire');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-ant-oat01-test');
    expect(headers['anthropic-version']).toBe('2023-06-01'); // api.anthropic.com rejects requests without it
    expect(headers['anthropic-beta']).toBe('experimental-cc-routine-2026-04-01');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: brief.instructions });
    expect(h.signal).toEqual({
      kind: 'claude-session',
      sessionId: 'sess-1',
      sessionUrl: 'https://claude.ai/s/1',
    });
    expect(backend.capabilities().zdrCompatible).toBe(false);
  });

  it('fails actionably when the routine import is missing', async () => {
    const backend = new ClaudeBackend({ gh: new FakeGitHub(), env: {} as NodeJS.ProcessEnv });
    await expect(backend.dispatch(brief)).rejects.toThrow(/loopdog connect claude/);
  });

  it('surfaces quota 429s without retry-storming', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;
    const backend = new ClaudeBackend({
      gh: new FakeGitHub(),
      env: {
        LOOPDOG_CLAUDE_FIRE_URL: 'https://x/fire',
        LOOPDOG_CLAUDE_FIRE_TOKEN: 't',
      } as NodeJS.ProcessEnv,
      fetchImpl,
    });
    await expect(backend.dispatch(brief)).rejects.toThrow(/429.*backing off/);
  });

  it('traces the /fire round-trip to stderr under LOOPDOG_DEBUG, never the token', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    try {
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({ session_id: 'sess-1', session_url: 'https://claude.ai/s/1' }),
          {
            status: 200,
          },
        )) as typeof fetch;
      const backend = new ClaudeBackend({
        gh: new FakeGitHub(),
        env: {
          LOOPDOG_CLAUDE_FIRE_URL: 'https://x/fire',
          LOOPDOG_CLAUDE_FIRE_TOKEN: 'sk-ant-oat01-secret',
          LOOPDOG_DEBUG: '1',
        } as NodeJS.ProcessEnv,
        fetchImpl,
      });
      await backend.dispatch(brief);
      const log = errors.join('\n');
      expect(log).toContain('dispatch → POST https://x/fire');
      expect(log).toContain(`run=${brief.runId}`);
      expect(log).toMatch(/dispatch ← HTTP 200/);
      expect(log).toContain('session=sess-1');
      expect(log).toContain('url=https://claude.ai/s/1');
      // the bearer token must never leak into logs
      expect(log).not.toContain('sk-ant-oat01-secret');
    } finally {
      spy.mockRestore();
    }
  });

  it('is silent on the /fire round-trip when LOOPDOG_DEBUG is unset', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ session_id: 'sess-1' }), { status: 200 })) as typeof fetch;
      const backend = new ClaudeBackend({
        gh: new FakeGitHub(),
        env: {
          LOOPDOG_CLAUDE_FIRE_URL: 'https://x/fire',
          LOOPDOG_CLAUDE_FIRE_TOKEN: 't',
        } as NodeJS.ProcessEnv,
        fetchImpl,
      });
      await backend.dispatch(brief);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('ingests a comment result posted AS THE USER, never the dispatch marker', async () => {
    const gh = new FakeGitHub();
    const backend = new ClaudeBackend({
      gh,
      env: {
        LOOPDOG_CLAUDE_FIRE_URL: 'https://x/fire',
        LOOPDOG_CLAUDE_FIRE_TOKEN: 't',
      } as NodeJS.ProcessEnv,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ session_id: 's1' }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-06-09T12:00:00Z'),
    });
    const h = await backend.dispatch({ ...brief, expectation: 'plan-update' });

    // The dispatch marker carries the trailer but no verdict — must NOT match.
    gh.actor = { login: 'github-actions[bot]', type: 'Bot' };
    await gh.createComment(item, `🛰️ dispatched\n\n${brief.expectedTrailer}`);
    expect(await backend.ingest(h)).toEqual({ status: 'pending' });

    // A Claude routine posts its result as the USER (not a bot), ending in the
    // verdict line — that is the completion signal.
    gh.actor = { login: 'dana', type: 'User' };
    await gh.createComment(item, `Groomed.\n\n${brief.expectedTrailer}\n\nloopdog-verdict: ready`);
    const result = await backend.ingest(h);
    expect(result.status).toBe('completed');
  });

  it('ingests a verdict from a formal PR review, not just issue comments', async () => {
    const gh = new FakeGitHub();
    const backend = new ClaudeBackend({
      gh,
      env: {
        LOOPDOG_CLAUDE_FIRE_URL: 'https://x/fire',
        LOOPDOG_CLAUDE_FIRE_TOKEN: 't',
      } as NodeJS.ProcessEnv,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ session_id: 's1' }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-06-09T12:00:00Z'),
    });
    const h = await backend.dispatch({ ...brief, item, expectation: 'comment' });
    expect(await backend.ingest(h)).toEqual({ status: 'pending' });

    // A reviewer submits a GitHub PR review (the idiomatic way) rather than an
    // issue comment — the verdict must still be read.
    gh.setReviews(item, [
      {
        author: { login: 'dana', type: 'User' },
        state: 'COMMENTED',
        submittedAt: '2026-06-09T12:05:00Z',
        body: `Intent-diff complete.\n\n${brief.expectedTrailer}\n\nloopdog-verdict: approve`,
      },
    ]);
    const result = await backend.ingest(h);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.verdict).toContain('loopdog-verdict: approve');
  });
});

describe('codex backend (0021)', () => {
  it('dispatches via an @codex mention with the contract; no provider id exists', async () => {
    const gh = new FakeGitHub();
    gh.seedIssue({ ref: item });
    const backend = new CodexBackend({ gh, now: () => new Date('2026-06-09T12:00:00Z') });

    const h = await backend.dispatch(brief);
    const comments = await gh.listComments(item);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toMatch(/^@codex /);
    expect(comments[0]!.body).toContain(brief.expectedTrailer);
    expect(h.signal).toEqual({
      kind: 'codex-mention',
      commentId: comments[0]!.id,
      mentionedAt: '2026-06-09T12:00:00.000Z',
    });

    const caps = backend.capabilities();
    expect(caps).toMatchObject({
      triggerModes: ['mention'],
      secretPhase: 'setup-only',
      network: 'off',
      throughput: { tasksPerHour: 5 },
    });
  });

  it('review expectation posts @codex review and ingests the bot verdict', async () => {
    const gh = new FakeGitHub();
    const pr = { ...repo, number: 42 };
    gh.seedPull({ ref: pr, headRef: 'feature/x' });
    const backend = new CodexBackend({ gh, now: () => new Date('2026-06-09T12:00:00Z') });

    const h = await backend.dispatch({ ...brief, item: pr, expectation: 'comment' });
    expect((await gh.listComments(pr))[0]!.body).toMatch(/^@codex review/);

    expect(await backend.ingest(h)).toEqual({ status: 'pending' });
    // the provider's verdict arrives
    gh.actor = { login: 'chatgpt-codex-connector[bot]', type: 'Bot' };
    await gh.createComment(pr, 'Code review: looks good. loopdog-verdict: approve');
    const result = await backend.ingest(h);
    expect(result.status).toBe('completed');
  });
});

describe('self-hosted backend (0074)', () => {
  it('dispatches the worker workflow with run inputs; the key travels as a NAME only', async () => {
    const gh = new FakeGitHub();
    const backend = new SelfHostedBackend({
      gh,
      agent: 'claude',
      apiKeySecretName: 'MY_MODEL_KEY',
      defaultBranch: 'main',
      now: () => new Date('2026-06-09T12:00:00Z'),
    });
    const h = await backend.dispatch(brief);
    expect(gh.workflowDispatches).toHaveLength(1);
    const d = gh.workflowDispatches[0]!;
    expect(d.workflowFile).toBe('loopdog-self-hosted-worker.yml');
    expect(d.inputs['api_key_secret']).toBe('MY_MODEL_KEY'); // a NAME, not a value
    expect(d.inputs['branch']).toBe(brief.expectedBranch);
    expect(JSON.stringify(d.inputs)).not.toMatch(/sk-/); // no plaintext key anywhere
    expect(h.signal.kind).toBe('workflow-run');

    const caps = backend.capabilities();
    expect(caps).toMatchObject({
      secretPhase: 'full',
      network: 'on',
      zdrCompatible: true,
      throughput: { tasksPerHour: null },
      triggerModes: ['self_hosted_dispatch'],
    });
  });

  it('ingests the worker PR through the same correlation as everyone else', async () => {
    const gh = new FakeGitHub();
    const backend = new SelfHostedBackend({ gh, now: () => new Date('2026-06-09T12:00:00Z') });
    const h = await backend.dispatch(brief);
    expect(await backend.ingest(h)).toEqual({ status: 'pending' });
    gh.seedPull({
      ref: { ...repo, number: 200 },
      headRef: brief.expectedBranch,
      body: '',
      updatedAt: '2026-06-09T12:30:00Z', // the worker pushed AFTER dispatch
    });
    const result = await backend.ingest(h);
    expect(result).toMatchObject({ status: 'completed', matchedBy: 'branch-name' });

    // a pre-existing untouched PR does NOT complete (fix-loop semantics, 0044)
    const stale = await backend.dispatch({
      ...brief,
      runId: 'run-2',
      expectedBranch: 'loopdog/x/9-run-2',
    });
    gh.seedPull({
      ref: { ...repo, number: 201 },
      headRef: 'loopdog/x/9-run-2',
      body: '',
      updatedAt: '2026-06-09T10:00:00Z', // BEFORE dispatch — no new push yet
    });
    expect(await backend.ingest(stale)).toEqual({ status: 'pending' });
  });
});

describe('capability mismatch (0021/0074)', () => {
  const gh = new FakeGitHub();
  it('flags secret/network gates against codex and passes them against self-hosted', () => {
    const loop = { requires: { liveSecrets: true, network: true } };
    const codexCaps = new CodexBackend({ gh }).capabilities();
    const selfCaps = new SelfHostedBackend({ gh }).capabilities();
    const mismatches = checkCompatibility(loop, codexCaps);
    expect(mismatches.map((m) => m.need).sort()).toEqual(['live-secrets', 'network']);
    expect(mismatches[0]!.directive).toContain('self-hosted');
    expect(checkCompatibility(loop, selfCaps)).toEqual([]);
    expect(checkCompatibility({}, codexCaps)).toEqual([]); // CI-only gates pass
  });
});

describe('selection + auth (0023)', () => {
  it('selects per the precedence chain, per stage', () => {
    const loop = (patch: object) => ({
      transition: { from: 'in-review', to: 'verified' },
      backend: undefined as string | undefined,
      reviewBackend: undefined as string | undefined,
      ...patch,
    });
    expect(deriveStage({ from: 'in-review', to: 'verified' })).toBe('review');
    expect(deriveStage({ from: 'ready-for-agent', to: 'in-review' })).toBe('implement');
    // loop-stage wins
    expect(
      selectBackend(
        { default: 'claude', review: 'claude' },
        loop({ reviewBackend: 'codex' }) as never,
      ),
    ).toBe('codex');
    // loop default next
    expect(
      selectBackend(
        { default: 'claude', review: 'codex' },
        loop({ backend: 'self-hosted' }) as never,
      ),
    ).toBe('self-hosted');
    // root stage next
    expect(selectBackend({ default: 'claude', review: 'codex' }, loop({}) as never)).toBe('codex');
    // root default
    expect(
      selectBackend({ default: 'codex' }, {
        transition: { from: 'ready-for-agent', to: 'in-review' },
      } as never),
    ).toBe('codex');
    // built-in default
    expect(
      selectBackend({}, { transition: { from: 'ready-for-agent', to: 'in-review' } } as never),
    ).toBe('claude');
  });

  it('resolveAuth: refs only; claude rejects API-key config; ZDR directs to self-hosted', () => {
    expect(
      resolveAuth('claude', {
        env: { LOOPDOG_CLAUDE_FIRE_URL: 'x', LOOPDOG_CLAUDE_FIRE_TOKEN: 'y' } as NodeJS.ProcessEnv,
      }),
    ).toEqual({
      kind: 'claude',
      fireUrl: 'LOOPDOG_CLAUDE_FIRE_URL',
      routineToken: 'LOOPDOG_CLAUDE_FIRE_TOKEN',
    });
    expect(() => resolveAuth('claude', { env: {} as NodeJS.ProcessEnv })).toThrow(
      /loopdog connect claude/,
    );
    expect(() =>
      resolveAuth('claude', { env: { ANTHROPIC_API_KEY: 'sk-ant-x' } as NodeJS.ProcessEnv }),
    ).toThrow(/does NOT satisfy/);
    expect(() => resolveAuth('claude', { zdr: true })).toThrow(BackendAuthError);
    expect(() => resolveAuth('claude', { zdr: true })).toThrow(/self-hosted/);

    expect(resolveAuth('codex')).toEqual({ kind: 'codex', providerAppRequired: true });
    expect(resolveAuth('self-hosted')).toEqual({
      kind: 'self-hosted',
      apiKey: 'LOOPDOG_MODEL_API_KEY',
    });
    expect(() => resolveAuth('gpt-9000')).toThrow(UnknownBackendError);
  });

  it('the registry holds exactly the fixed backend set', () => {
    const registry = createBackendRegistry({ gh: new FakeGitHub() });
    expect([...registry.keys()].sort()).toEqual(['claude', 'codex', 'self-hosted']);
  });
});
