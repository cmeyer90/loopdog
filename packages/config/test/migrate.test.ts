import { describe, expect, it } from 'vitest';
import {
  CONFIG_VERSION,
  MIN_MIGRATABLE_FROM,
  MIGRATIONS,
  classifyVersion,
  migrateTree,
  planUpgrade,
} from '@loopdog/config';

/**
 * Versioned config contract + migration registry (M15 · 0067): the version gate
 * + an ordered, gap-checked, idempotent migration chain. V1 is the baseline
 * (no migrations yet), so the machinery's behaviors are: current → no-op,
 * ahead/too-old → refuse, behind → migrate.
 */

describe('config version contract (0067)', () => {
  it('classifies an on-disk version against what loopdog understands', () => {
    expect(classifyVersion(CONFIG_VERSION)).toBe('current');
    expect(classifyVersion(CONFIG_VERSION + 1)).toBe('ahead'); // downgrade
    expect(classifyVersion(MIN_MIGRATABLE_FROM - 1)).toBe('too-old');
  });

  it('plans a no-op for a current tree and refuses ahead/too-old', () => {
    expect(planUpgrade(CONFIG_VERSION)).toMatchObject({ ok: true, status: 'current', steps: [] });
    expect(planUpgrade(CONFIG_VERSION + 1).ok).toBe(false); // refuse a downgrade
    expect(planUpgrade(MIN_MIGRATABLE_FROM - 1).ok).toBe(false); // refuse too-old
  });

  it('the migration registry is contiguous and ends at CONFIG_VERSION', () => {
    // (the gap-check runs at module load; here we assert the chain shape)
    let expected = MIN_MIGRATABLE_FROM;
    for (const m of MIGRATIONS) {
      expect(m.from).toBe(expected);
      expect(m.to).toBe(m.from + 1);
      expected = m.to;
    }
    expect(expected).toBe(CONFIG_VERSION);
  });

  it('migrateTree is idempotent and a no-op at the current version', () => {
    const tree = { 'loopdog.yml': 'version: 1\n' };
    expect(migrateTree(tree, CONFIG_VERSION)).toEqual(tree);
    // Applying again yields the same tree (idempotent).
    expect(migrateTree(migrateTree(tree, CONFIG_VERSION), CONFIG_VERSION)).toEqual(tree);
  });

  it('migrateTree throws on a non-migratable (ahead/too-old) version', () => {
    expect(() => migrateTree({}, CONFIG_VERSION + 1)).toThrow(/newer than this loopdog/);
    expect(() => migrateTree({}, MIN_MIGRATABLE_FROM - 1)).toThrow(/older than the minimum/);
  });
});
