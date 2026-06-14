import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '@loopdog/testing';
import type { WorkflowSummary } from '@loopdog/core';
import {
  applyWorkflowState,
  isLoopdogWorkflow,
  matchWorkflow,
  renderWorkflowList,
  selectTargets,
  shortName,
} from '../src/commands/workflows.js';

function wf(partial: Partial<WorkflowSummary> & { path: string }): WorkflowSummary {
  return { id: 1, name: partial.path, state: 'active', ...partial };
}

const events = wf({ id: 10, name: 'loopdog-events', path: '.github/workflows/loopdog-events.yml' });
const sweep = wf({
  id: 11,
  name: 'loopdog-sweep',
  path: '.github/workflows/loopdog-sweep.yml',
  state: 'disabled_manually',
});
const ci = wf({ id: 12, name: 'ci', path: '.github/workflows/ci.yml' });

describe('workflow identity + naming (0099)', () => {
  it('recognizes loopdog-owned workflows by filename', () => {
    expect(isLoopdogWorkflow(events)).toBe(true);
    expect(isLoopdogWorkflow(sweep)).toBe(true);
    expect(isLoopdogWorkflow(ci)).toBe(false);
  });

  it('derives a short handle from the path', () => {
    expect(shortName(events)).toBe('events');
    expect(shortName(sweep)).toBe('sweep');
    expect(shortName(ci)).toBe('ci');
  });

  it('matches a workflow by short name, full filename, or display name', () => {
    const all = [events, sweep, ci];
    expect(matchWorkflow('events', all)?.id).toBe(10);
    expect(matchWorkflow('loopdog-events', all)?.id).toBe(10);
    expect(matchWorkflow('loopdog-events.yml', all)?.id).toBe(10);
    expect(matchWorkflow('SWEEP', all)?.id).toBe(11); // case-insensitive
    expect(matchWorkflow('ci', all)?.id).toBe(12);
    expect(matchWorkflow('nope', all)).toBeUndefined();
  });
});

describe('target selection (0099)', () => {
  const all = [events, sweep, ci];
  const loopdog = [events, sweep];

  it('defaults to all loopdog workflows (never the user’s ci) when no names given', () => {
    const { targets, unknown } = selectTargets(all, loopdog, []);
    expect(targets.map((t) => t.id)).toEqual([10, 11]);
    expect(unknown).toEqual([]);
  });

  it('resolves named workflows against ALL workflows and reports unknowns', () => {
    const { targets, unknown } = selectTargets(all, loopdog, ['sweep', 'ci', 'ghost']);
    expect(targets.map((t) => t.id)).toEqual([11, 12]);
    expect(unknown).toEqual(['ghost']);
  });

  it('dedupes when the same workflow is named twice', () => {
    const { targets } = selectTargets(all, loopdog, ['events', 'loopdog-events.yml']);
    expect(targets.map((t) => t.id)).toEqual([10]);
  });
});

describe('list rendering (0099)', () => {
  it('shows a ● for enabled and ○ for disabled, with a summary', () => {
    const out = renderWorkflowList('me/repo', [events, sweep], [events, sweep, ci], false);
    expect(out).toContain('● ');
    expect(out).toContain('○ ');
    expect(out).toContain('events');
    expect(out).toContain('1 enabled · 1 disabled');
  });

  it('guides the user when nothing is registered yet', () => {
    const out = renderWorkflowList('me/repo', [], [], false);
    expect(out).toContain('push .github/workflows/ first');
  });
});

describe('applyWorkflowState against the GitHub port (0099)', () => {
  const repo = { owner: 'me', repo: 'repo' };

  it('enables disabled workflows and reports before/after; round-trips through the port', async () => {
    const gh = new FakeGitHub();
    gh.seedWorkflow(repo, {
      id: 10,
      name: 'loopdog-events',
      path: '.github/workflows/loopdog-events.yml',
    });
    gh.seedWorkflow(repo, {
      id: 11,
      name: 'loopdog-sweep',
      path: '.github/workflows/loopdog-sweep.yml',
      state: 'disabled_manually',
    });

    const before = await gh.listWorkflows(repo);
    const loopdog = before.filter(isLoopdogWorkflow);
    const changes = await applyWorkflowState(gh, repo, 'enable', loopdog);

    expect(changes.map((c) => [shortName(c.workflow), c.before, c.after])).toEqual([
      ['events', 'active', 'active'],
      ['sweep', 'disabled_manually', 'active'],
    ]);
    const after = await gh.listWorkflows(repo);
    expect(after.every((w) => w.state === 'active')).toBe(true);
  });

  it('disables workflows through the port', async () => {
    const gh = new FakeGitHub();
    gh.seedWorkflow(repo, {
      id: 11,
      name: 'loopdog-sweep',
      path: '.github/workflows/loopdog-sweep.yml',
    });

    await applyWorkflowState(gh, repo, 'disable', await gh.listWorkflows(repo));
    const [sweepAfter] = await gh.listWorkflows(repo);
    expect(sweepAfter!.state).toBe('disabled_manually');
  });
});
