import { describe, expect, it } from 'vitest';
import { assessControllerDrift, readPinnedVersion } from '../src/commands/controller-version.js';

const caller = (version: string) => `jobs:
  loopdog:
    uses: cmeyer90/loopdog/.github/workflows/reusable-events.yml@v0
    with:
      loopdog-version: ${version}
`;

describe('readPinnedVersion (0101)', () => {
  it('extracts the loopdog-version value, quoted or not', () => {
    expect(readPinnedVersion(caller('0.2.0'))).toBe('0.2.0');
    expect(readPinnedVersion(caller("'0'"))).toBe('0');
    expect(readPinnedVersion(caller("'0.4.0' # exact pin"))).toBe('0.4.0');
  });

  it('returns null when there is no loopdog-version line', () => {
    expect(readPinnedVersion('name: ci\non: push\n')).toBeNull();
  });
});

describe('assessControllerDrift (0101)', () => {
  it('flags an exact pin older than the CLI as behind (the actionable case)', () => {
    const d = assessControllerDrift([caller('0.2.0')], '0.4.0');
    expect(d).toEqual({ status: 'behind', pinned: '0.2.0', cli: '0.4.0' });
  });

  it('treats a bare major as floating (auto-tracks, never stale)', () => {
    expect(assessControllerDrift([caller("'0'")], '0.4.0').status).toBe('floating');
  });

  it('is current when an exact pin equals the CLI, ahead when newer', () => {
    expect(assessControllerDrift([caller('0.4.0')], '0.4.0').status).toBe('current');
    expect(assessControllerDrift([caller('0.5.0')], '0.4.0').status).toBe('ahead');
  });

  it('reports none when no caller pins a version', () => {
    expect(assessControllerDrift(['name: ci\n'], '0.4.0')).toEqual({
      status: 'none',
      pinned: null,
      cli: '0.4.0',
    });
  });

  it('reports the worst case across callers (one behind wins)', () => {
    const d = assessControllerDrift([caller("'0'"), caller('0.2.0')], '0.4.0');
    expect(d.status).toBe('behind');
    expect(d.pinned).toBe('0.2.0');
  });

  it('compares numerically, not lexically (0.10.0 > 0.9.0)', () => {
    expect(assessControllerDrift([caller('0.10.0')], '0.9.0').status).toBe('ahead');
    expect(assessControllerDrift([caller('0.9.0')], '0.10.0').status).toBe('behind');
  });
});
