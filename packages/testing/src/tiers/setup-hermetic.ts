import { assertNoSecrets } from './network-guard.js';
import { installNetworkGuard } from './network-guard.js';

/**
 * Hermetic test setup (task 0087), wired as a vitest `setupFiles` entry. It
 * SELF-GATES on `LOOPDOG_HERMETIC=1` so it enforces in CI (where the guarantee
 * matters) without breaking local `npm test` for a developer who happens to
 * have `GITHUB_TOKEN` exported. When enabled it:
 *   - asserts no provider/`GITHUB_TOKEN` secret is present (fail loudly), and
 *   - installs the network guard so any outbound socket is a red test.
 */
if (process.env['LOOPDOG_HERMETIC'] === '1') {
  const secrets = assertNoSecrets();
  if (!secrets.ok) {
    throw new Error(
      `hermetic tiers (1–4) must run with NO secrets in the env, but found: ` +
        `${secrets.present.join(', ')}. A leaked secret is a leaked spend path.`,
    );
  }
  installNetworkGuard();
}
