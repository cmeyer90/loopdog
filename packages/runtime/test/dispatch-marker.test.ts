import { describe, expect, it } from 'vitest';
import { renderDispatchMarker } from '@loopdog/runtime';
import type { CorrelationSignal, DispatchHandle } from '@loopdog/core';

function handle(signal: CorrelationSignal): DispatchHandle {
  return {
    runId: 'run-implement-1-a0-deadbeef',
    backend: 'claude',
    item: { owner: 'o', repo: 'r', number: 1 },
    dispatchedAt: '2026-06-14T12:00:00Z',
    expectedBranch: 'loopdog/implement/1-run',
    expectedTrailer: 'loopdog-run: run-implement-1-a0-deadbeef',
    expectation: 'pull-request',
    signal,
  };
}

describe('renderDispatchMarker session visibility (0103)', () => {
  it('surfaces the live session URL as an auto-linkable line', () => {
    const body = renderDispatchMarker(
      handle({ kind: 'claude-session', sessionId: 'sess-1', sessionUrl: 'https://claude.ai/s/1' }),
    );
    expect(body).toContain('🔭 live session: https://claude.ai/s/1');
    // still embeds the machine-readable handle for crash-safe ingestion
    expect(body).toContain('<!-- loopdog:dispatch ');
  });

  it('falls back to the session id when no URL is returned', () => {
    const body = renderDispatchMarker(handle({ kind: 'claude-session', sessionId: 'sess-1' }));
    expect(body).toContain('🔭 session: `sess-1`');
  });

  it('omits the line for the unknown-session placeholder', () => {
    const body = renderDispatchMarker(
      handle({ kind: 'claude-session', sessionId: 'unknown-session' }),
    );
    expect(body).not.toContain('🔭');
  });

  it('omits the line for backends without a followable session', () => {
    const body = renderDispatchMarker(
      handle({ kind: 'codex-mention', commentId: 7, mentionedAt: '2026-06-14T12:00:00Z' }),
    );
    expect(body).not.toContain('🔭');
  });
});
