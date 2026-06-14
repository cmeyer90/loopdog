import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  LIVE_GLOB,
  assertNoSecrets,
  classifyDrift,
  installNetworkGuard,
  parseTierSelector,
  selectorRequiresIO,
  tierGlobs,
  tiersForSelector,
} from '@loopdog/testing';

/**
 * Tier runner + hermeticity guards (task 0087): proves the load-bearing
 * zero-quota guarantee for tiers 1–4 — the network guard turns any outbound
 * socket into a failing test, secrets must be absent, and the selector keeps
 * the live tier out of the per-PR run. Also covers the drift classifier.
 */

describe('tier selection (0087)', () => {
  it('parses LOOPDOG_TIER and maps to include/exclude globs', () => {
    expect(parseTierSelector(undefined)).toBe('1-4');
    expect(parseTierSelector('1-4')).toBe('1-4');
    expect(parseTierSelector('5')).toBe('5');
    expect(parseTierSelector('live')).toBe('5');
    expect(parseTierSelector('all')).toBe('all');

    // 1–4 EXCLUDES the live glob — a real subscription is never touched on a PR.
    const hermetic = tierGlobs('1-4');
    expect(hermetic.exclude).toContain(LIVE_GLOB);
    expect(hermetic.include).not.toContain(LIVE_GLOB);
    expect(selectorRequiresIO('1-4')).toBe(false);

    // tier 5 runs ONLY the live glob and is the only IO-requiring selector.
    const live = tierGlobs('5');
    expect(live.include).toEqual([LIVE_GLOB]);
    expect(selectorRequiresIO('5')).toBe(true);

    expect(tiersForSelector('1-4')).not.toContain('live-smoke');
    expect(tiersForSelector('5')).toEqual(['live-smoke']);
  });
});

describe('network guard (0087, hermeticity)', () => {
  it('blocks an outbound connection to a real host (a red test, not a quota burn)', () => {
    const guard = installNetworkGuard();
    try {
      expect(() => new net.Socket().connect({ host: 'api.github.com', port: 443 })).toThrow(
        /network guard/,
      );
      expect(() => new net.Socket().connect({ host: 'api.anthropic.com', port: 443 })).toThrow(
        /network guard/,
      );
      // The polymorphic connect(port, host) form is guarded too.
      expect(() => new net.Socket().connect(443, 'example.com')).toThrow(/network guard/);
      expect(guard.blocked).toContain('api.github.com');
    } finally {
      guard.uninstall();
    }
  });

  it('allows localhost / IPC so vitest workers keep functioning', () => {
    const guard = installNetworkGuard();
    try {
      // A localhost connect is permitted by the guard; it async-errors on
      // ECONNREFUSED, which we swallow — the point is no SYNCHRONOUS guard throw.
      const socket = new net.Socket();
      socket.on('error', () => {});
      expect(() => socket.connect({ host: '127.0.0.1', port: 1 })).not.toThrow();
      socket.destroy();
      expect(guard.blocked).not.toContain('127.0.0.1');
    } finally {
      guard.uninstall();
    }
  });

  it('uninstall restores the original connect', () => {
    const before = net.Socket.prototype.connect;
    const guard = installNetworkGuard();
    expect(net.Socket.prototype.connect).not.toBe(before);
    guard.uninstall();
    expect(net.Socket.prototype.connect).toBe(before);
  });
});

describe('secret absence (0087, hermeticity)', () => {
  it('passes with a clean env and fails when a provider/GITHUB_TOKEN secret is present', () => {
    expect(assertNoSecrets({})).toEqual({ ok: true, present: [] });
    const leaked = assertNoSecrets({ GITHUB_TOKEN: 'ghp_x', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(leaked.ok).toBe(false);
    expect(leaked.present).toContain('GITHUB_TOKEN');
    expect(leaked.present).toContain('ANTHROPIC_API_KEY');
    // An empty-string value is treated as absent (unset).
    expect(assertNoSecrets({ GITHUB_TOKEN: '' }).ok).toBe(true);
  });
});

describe('drift classification (0087)', () => {
  it('classifies capability, api, and correlation drift', () => {
    const clean = classifyDrift(
      { capabilities: { opensPr: true }, api: { triggerMode: 'api_fire' } },
      { capabilities: { opensPr: true }, api: { triggerMode: 'api_fire' } },
    );
    expect(clean.drifted).toBe(false);

    const drifted = classifyDrift(
      {
        capabilities: { opensPr: true, zdrCompatible: true },
        api: { triggerMode: 'api_fire' },
        correlation: { trailerKey: 'loopdog-run' },
      },
      {
        capabilities: { opensPr: true, zdrCompatible: false }, // capability flag flipped
        api: { triggerMode: 'mention' }, // api contract changed
        correlation: { trailerKey: 'loopdog-trace' }, // correlation shape changed
      },
    );
    expect(drifted.drifted).toBe(true);
    const kinds = new Set(drifted.findings.map((f) => f.kind));
    expect(kinds).toEqual(new Set(['capability', 'api', 'correlation']));
    expect(drifted.summary).toMatch(/capability drift/);
  });
});
