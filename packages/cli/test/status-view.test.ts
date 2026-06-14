import { describe, expect, it } from 'vitest';
import type { LoopDefinition } from '@loopdog/core';
import { buildLoopRows, renderStatus, type StatusView } from '../src/render/status-view.js';

function loop(
  over: Partial<LoopDefinition> & Pick<LoopDefinition, 'name' | 'transition'>,
): LoopDefinition {
  return {
    backend: 'claude',
    gates: { requireDor: true, requireCi: true, tier: 'default' },
    promptPath: `.loopdog/loops/${over.name}/prompt.md`,
    mode: 'act',
    trigger: { kind: 'github_event', events: ['issues.labeled'] },
    ...over,
  } as LoopDefinition;
}

// Intentionally out of lifecycle order — buildLoopRows must sort them.
const LOOPS: LoopDefinition[] = [
  loop({
    name: 'merge',
    transition: { from: 'verified', to: 'merged' },
    gates: { requireDor: false, requireCi: true, tier: 'core' },
    mode: 'dry-run',
  }),
  loop({
    name: 'triage',
    transition: { from: 'new', to: 'needs-grooming' },
    gates: { requireDor: false, requireCi: false, tier: 'safe' },
  }),
  loop({
    name: 'review',
    transition: { from: 'in-review', to: 'verified', fallback: 'changes-requested' },
    mode: 'suggest',
  }),
  loop({ name: 'implement', transition: { from: 'ready-for-agent', to: 'in-review' } }),
];

describe('buildLoopRows', () => {
  it('orders loops along the lifecycle and maps modes/counts', () => {
    const rows = buildLoopRows(LOOPS, { new: 3, 'in-review': 1 }, true);
    expect(rows.map((r) => r.name)).toEqual(['triage', 'implement', 'review', 'merge']);
    expect(rows.find((r) => r.name === 'triage')!.waiting).toBe(3);
    expect(rows.find((r) => r.name === 'implement')!.waiting).toBe(0);
    expect(rows.find((r) => r.name === 'merge')!.mode).toBe('observe'); // dry-run -> observe
    expect(rows.find((r) => r.name === 'review')!.mode).toBe('suggest');
    expect(rows.find((r) => r.name === 'merge')!.gated).toBe(true); // core + -> merged
    expect(rows.find((r) => r.name === 'triage')!.gated).toBe(false);
  });

  it('sets waiting to null when live counts are unavailable', () => {
    const rows = buildLoopRows(LOOPS, {}, false);
    expect(rows.every((r) => r.waiting === null)).toBe(true);
  });

  it('drops a fallback that just stays in the from-state', () => {
    const rows = buildLoopRows(
      [
        loop({
          name: 'clarify',
          transition: {
            from: 'needs-clarification',
            to: 'ready-for-agent',
            fallback: 'needs-clarification',
          },
        }),
      ],
      {},
      false,
    );
    expect(rows[0]!.fallback).toBeUndefined();
  });
});

function view(over: Partial<StatusView> = {}): StatusView {
  return {
    repo: 'acme/widget',
    killSwitch: false,
    backendDefault: 'claude',
    loops: buildLoopRows(LOOPS, { new: 3, 'in-review': 1 }, true),
    attention: [],
    throughput: { runs24h: 16, done: 9, failed: 2 },
    live: true,
    ...over,
  };
}

describe('renderStatus', () => {
  it('lists every configured loop with mode + tier, even with no queued items', () => {
    const out = renderStatus(view());
    for (const name of ['triage', 'implement', 'review', 'merge']) {
      expect(out).toContain(name);
    }
    expect(out).toContain('acme/widget');
    expect(out).toContain('4 loops');
    expect(out).toContain('STAGE');
    expect(out).toContain('WAIT');
    // gated core merge marked + explained
    expect(out).toContain('core*');
    expect(out).toContain('gated');
    // live throughput
    expect(out).toContain('16 runs');
    expect(out).toContain('9 done');
  });

  it('shows the queued count for the entry state of a loop', () => {
    const out = renderStatus(view());
    const triageLine = out.split('\n').find((l) => l.includes('triage'))!;
    expect(triageLine).toContain('3'); // 3 items waiting in `new`
  });

  it('makes the kill switch prominent when on', () => {
    expect(renderStatus(view({ killSwitch: true }))).toContain('KILL-SWITCH ON');
    expect(renderStatus(view({ killSwitch: false }))).toContain('kill-switch off');
  });

  it('renders an attention section only when items wait on a human', () => {
    expect(renderStatus(view())).not.toContain('ATTENTION');
    const out = renderStatus(view({ attention: [{ label: 'loopdog:needs-human', count: 2 }] }));
    expect(out).toContain('ATTENTION');
    expect(out).toContain('loopdog:needs-human');
  });

  it('degrades to a config-only render when live data is unavailable', () => {
    const out = renderStatus(
      view({ live: false, liveError: 'no GitHub auth', loops: buildLoopRows(LOOPS, {}, false) }),
    );
    expect(out).toContain('live counts unavailable');
    expect(out).toContain('no GitHub auth');
    // loops still listed
    expect(out).toContain('triage');
    // no throughput numbers claimed
    expect(out).not.toContain('16 runs');
  });

  it('handles an empty config with a hint', () => {
    const out = renderStatus(view({ loops: [] }));
    expect(out).toContain('No loops configured');
    expect(out).toContain('loopdog init');
  });
});
