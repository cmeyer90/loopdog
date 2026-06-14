import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deleteStoredToken, readStoredToken, storeToken } from '../auth/token-store.js';

const execFileAsync = promisify(execFile);

/**
 * `loopdog login` / `loopdog auth status` / `loopdog logout` (task 0077) — the
 * keyless connector. Preference order:
 *   1. existing `gh` auth (zero new credentials)
 *   2. GitHub OAuth DEVICE FLOW via loopdog's public OAuth-App client_id
 *      (no secret, no hosted backend — the documented keyless path)
 * Tokens land in the OS keychain (service `loopdog`; 0600 ~/.loopdog/auth.json
 * fallback with a plaintext warning). In CI the controller never logs in — it
 * uses the workflow's GITHUB_TOKEN. The token is never printed anywhere.
 */

/** Loopdog's public OAuth App client id (a public identifier, not a secret). */
const DEFAULT_CLIENT_ID = process.env['LOOPDOG_OAUTH_CLIENT_ID'] ?? 'Ov23liLoopdogPublicApp';

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('connect GitHub (browser device flow, or reuse existing gh auth)')
    .option('--device', 'force the OAuth device flow even when gh auth exists', false)
    .option('--no-connect', 'do not chain into provider connect afterwards')
    .action(async (opts: { device: boolean; connect: boolean }) => {
      if (!opts.device) {
        try {
          const { stdout } = await execFileAsync('gh', ['auth', 'token']);
          const token = stdout.trim();
          if (token) {
            const { stdout: who } = await execFileAsync('gh', ['api', 'user', '--jq', '.login']);
            console.log(`✓ reusing existing gh auth (logged in as ${who.trim()})`);
            console.log('  loopdog will use `gh auth token` locally; no new credential stored.');
            maybeChainConnect(opts.connect);
            return;
          }
        } catch {
          // no gh — fall through to device flow
        }
      }

      console.log('starting GitHub OAuth device flow…');
      const { createOAuthDeviceAuth } = await import('@octokit/auth-oauth-device');
      const auth = createOAuthDeviceAuth({
        clientType: 'oauth-app',
        clientId: DEFAULT_CLIENT_ID,
        scopes: ['repo'],
        onVerification: (verification) => {
          console.log(`\n  open:  ${verification.verification_uri}`);
          console.log(`  code:  ${verification.user_code}\n`);
          console.log('waiting for you to authorize in the browser…');
        },
      });
      const { token } = await auth({ type: 'oauth' });
      const where = await storeToken(token, 'github');
      if (where === 'keychain') {
        console.log('✓ logged in; token stored in the OS keychain (service `loopdog`).');
      } else {
        console.log(
          '✓ logged in; keychain unavailable — token stored in PLAINTEXT at ' +
            '~/.loopdog/auth.json (mode 0600). Consider a keychain-equipped machine.',
        );
      }
      maybeChainConnect(opts.connect);
    });

  const auth = program.command('auth').description('authentication status');
  auth
    .command('status')
    .description('report login method and provider-connection state (never prints tokens)')
    .action(async () => {
      if (process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN']) {
        console.log('auth: using GITHUB_TOKEN/GH_TOKEN from the environment (CI mode)');
        return;
      }
      let method: string | null = null;
      try {
        const { stdout } = await execFileAsync('gh', ['auth', 'token']);
        if (stdout.trim()) {
          const { stdout: who } = await execFileAsync('gh', ['api', 'user', '--jq', '.login']);
          method = `gh auth (logged in as ${who.trim()})`;
        }
      } catch {
        // no gh
      }
      if (!method && (await readStoredToken())) {
        method = 'stored token (loopdog login device flow)';
      }
      if (!method) {
        console.log('auth: NOT logged in — run `loopdog login`');
        process.exitCode = 3;
        return;
      }
      console.log(`auth: ${method}`);

      // Provider-connection state (best effort, via gh secret list).
      try {
        const { stdout } = await execFileAsync('gh', ['secret', 'list']);
        const hasClaude = stdout.includes('LOOPDOG_CLAUDE_FIRE_URL');
        console.log(
          `claude: ${hasClaude ? 'connected (fire URL secret present)' : 'not connected — loopdog connect claude'}`,
        );
      } catch {
        console.log('claude: unknown (run inside a repo with gh to check secrets)');
      }
      console.log('codex: verify with a manual `@codex review` comment (provider App)');
    });

  program
    .command('logout')
    .description('remove the stored loopdog token (idempotent)')
    .action(async () => {
      await deleteStoredToken();
      console.log('✓ logged out (stored token removed; gh auth, if any, is untouched).');
    });
}

function maybeChainConnect(connect: boolean): void {
  if (!connect) return;
  console.log(
    [
      '',
      'Next: connect your provider subscription —',
      '  loopdog connect claude    (manual routine import: /fire URL + token)',
      '  loopdog connect codex     (provider GitHub App authorization)',
    ].join('\n'),
  );
}
