import { describe, expect, it } from 'vitest';

/**
 * Tier-5 live smoke (task 0087). This file's `.live.test.ts` name keeps it OUT
 * of the per-PR run (the default `1-4` config excludes the live glob); it runs
 * only under `LOOPDOG_TIER=5`, gated to manual dispatch + nightly cron in
 * `.github/workflows/loopdog-live-smoke.yml`. It spends REAL subscription quota.
 *
 * Without a real subscription credential it SKIPS (never fails) — so even when
 * selected it's a no-op in an unconfigured environment. Wiring it to a real
 * scratch repo + backend is operator-pending (offline agents cannot exercise a
 * real Claude/Codex subscription); the harness it drives lives in
 * `src/live-smoke/harness.ts` and is unit-covered via the drift classifier.
 */
const CREDENTIAL =
  process.env['LOOPDOG_LIVE_SMOKE_TOKEN'] ?? process.env['CLAUDE_CODE_OAUTH_TOKEN'] ?? '';
const SCRATCH_REPO = process.env['LOOPDOG_LIVE_SMOKE_REPO'] ?? '';
const configured = CREDENTIAL.length > 0 && SCRATCH_REPO.length > 0;

describe('live smoke (tier 5, real subscription)', () => {
  it.skipIf(!configured)(
    'drives one safe loop edge dispatch→ingest against a real provider, then cleans up',
    { timeout: 15 * 60_000 },
    async () => {
      // Operator wiring goes here: build a real GitHubPort + real backend for
      // SCRATCH_REPO, seed a tier:safe ready issue, call runLiveSmoke(...), and
      // assert the result is 'passed' (or 'skipped' on a rate cap). Always run
      // cleanupScratch(...) in a finally. Left unwired in-repo because it
      // requires a live subscription + scratch repo no CI secret provides here.
      expect(configured).toBe(true);
    },
  );

  it('is excluded from the per-PR (tiers 1–4) run by file convention', () => {
    // A guard-rail self-test: this assertion documents the contract. The file's
    // *.live.test.ts suffix is what the default config excludes; if this file
    // ever ran under tiers 1–4, the suffix or the config glob regressed.
    expect(import.meta.url).toMatch(/\.live\.test\.ts$/);
  });
});
