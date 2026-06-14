import { describe, expect, it } from 'vitest';
import {
  claimLabel,
  isLeaseExpired,
  leaseExpiry,
  leaseLabel,
  parseClaims,
  parseLeaseExpiry,
  resolveClaimRace,
} from '@loopdog/core';

describe('claim protocol (0013)', () => {
  it('claim labels round-trip through item labels', () => {
    const labels = ['loopdog:state/ready-for-agent', claimLabel('run-b'), claimLabel('run-a')];
    expect(parseClaims(labels)).toEqual(['run-a', 'run-b']);
  });

  it('resolves a double-claim race deterministically (lowest run id wins)', () => {
    expect(resolveClaimRace(['run-b', 'run-a'])).toBe('run-a');
    expect(resolveClaimRace(['run-a', 'run-b'])).toBe('run-a'); // order-independent
    expect(resolveClaimRace([])).toBeNull();
  });

  it('lease labels round-trip the expiry instant and fit the 50-char limit', () => {
    const expiry = leaseExpiry(new Date('2026-06-09T10:00:00Z'), 30);
    expect(expiry).toBe('2026-06-09T10:30:00.000Z');
    const label = leaseLabel(expiry);
    expect(label.length).toBeLessThanOrEqual(50);
    expect(parseLeaseExpiry([label])).toBe(expiry);
  });

  it('compacts oversized run ids so claim labels fit the 50-char limit', () => {
    const long = 'run-a-very-long-custom-loop-name-142-a3-deadbeef';
    const label = claimLabel(long);
    expect(label.length).toBeLessThanOrEqual(50);
    expect(claimLabel(long)).toBe(label); // deterministic
    expect(parseClaims([label])[0]).not.toBe(parseClaims([claimLabel(long + 'x')])[0]);
  });

  it('expires leases at/after the instant; live before', () => {
    const expiry = '2026-06-09T10:30:00.000Z';
    expect(isLeaseExpired(expiry, new Date('2026-06-09T10:29:59Z'))).toBe(false);
    expect(isLeaseExpired(expiry, new Date('2026-06-09T10:30:00Z'))).toBe(true);
  });

  it('fails open to recovery on missing/garbled leases', () => {
    expect(isLeaseExpired(null, new Date())).toBe(true);
    expect(isLeaseExpired('not-a-date', new Date())).toBe(true);
  });
});
