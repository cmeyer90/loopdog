import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '@looper/testing';
import { parseActionsEvent, reconcileLabels } from '@looper/github';
import { DEFAULT_TRANSITION_TABLE } from '@looper/core';

const repo = { owner: 'o', repo: 'r' };

describe('label reconciliation IO (0011)', () => {
  it('creates all looper labels once; second run is a no-op; customs untouched', async () => {
    const gh = new FakeGitHub();
    await gh.createRepoLabel(repo, { name: 'bug', color: 'ff0000' });
    gh.mutations.length = 0;

    const first = await reconcileLabels(gh, repo, DEFAULT_TRANSITION_TABLE);
    expect(first.created).toContain('looper:state/new');
    expect(first.created).toContain('looper:quarantine');

    const second = await reconcileLabels(gh, repo, DEFAULT_TRANSITION_TABLE);
    expect(second.created).toEqual([]);

    const labels = await gh.listRepoLabels(repo);
    expect(labels.find((l) => l.name === 'bug')).toEqual({ name: 'bug', color: 'ff0000' });
  });
});

describe('event normalization (0008)', () => {
  it('normalizes an issues.labeled event with item, actor, and label', () => {
    const ev = parseActionsEvent(
      'issues',
      {
        action: 'labeled',
        issue: { number: 7, author_association: 'OWNER' },
        label: { name: 'looper:state/new' },
        sender: { login: 'dana', type: 'User' },
      },
      repo,
      '2026-06-09T12:00:00Z',
    );
    expect(ev).toEqual({
      kind: 'event',
      name: 'issues.labeled',
      item: { ...repo, number: 7 },
      actor: { login: 'dana', type: 'User' },
      authorAssociation: 'OWNER',
      label: 'looper:state/new',
      deliveredAt: '2026-06-09T12:00:00Z',
    });
  });

  it('normalizes schedule to a cron trigger (the trusted system actor)', () => {
    expect(parseActionsEvent('schedule', {}, repo, 'now')).toEqual({
      kind: 'cron',
      deliveredAt: 'now',
    });
  });

  it('resolves the PR number from workflow_run/check_suite payloads', () => {
    const ev = parseActionsEvent(
      'workflow_run',
      {
        action: 'completed',
        workflow_run: { pull_requests: [{ number: 42 }] },
        sender: { login: 'x' },
      },
      repo,
      'now',
    );
    expect(ev.kind === 'event' && ev.item?.number).toBe(42);
  });

  it('normalizes comment events with the commenter association (authorization input)', () => {
    const ev = parseActionsEvent(
      'issue_comment',
      {
        action: 'created',
        issue: { number: 3 },
        comment: { author_association: 'NONE' },
        sender: { login: 'stranger', type: 'User' },
      },
      repo,
      'now',
    );
    expect(ev.kind === 'event' && ev.authorAssociation).toBe('NONE');
  });
});
