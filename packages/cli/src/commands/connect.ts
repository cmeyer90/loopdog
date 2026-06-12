import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * `looper connect <provider>` (task 0010): guided subscription onboarding via
 * the provider's VALIDATED surface. Claude = manual routine/API-trigger import
 * (the 0093 decision: looper never creates routines/tokens programmatically);
 * Codex = the provider's GitHub App. No model API keys on this path.
 */

export const CLAUDE_FIRE_URL_SECRET = 'LOOPER_CLAUDE_FIRE_URL';
export const CLAUDE_FIRE_TOKEN_SECRET = 'LOOPER_CLAUDE_FIRE_TOKEN';

export function registerConnect(program: Command): void {
  const connect = program
    .command('connect')
    .description('connect a provider subscription (claude | codex)');

  connect
    .command('claude')
    .description('import a Claude routine /fire URL + bearer token as Actions secrets')
    .option('--repo <owner/name>', 'repository to store the secrets in (default: cwd repo)')
    .option('--rotate', 're-import even when the secrets already exist', false)
    .action(async (opts: { repo?: string; rotate: boolean }) => {
      // Idempotent re-run: already connected → no-op unless rotating.
      if (!opts.rotate) {
        try {
          const { stdout } = await execFileAsync('gh', [
            'secret',
            'list',
            ...(opts.repo ? ['--repo', opts.repo] : []),
          ]);
          if (stdout.includes(CLAUDE_FIRE_URL_SECRET)) {
            console.log(
              `✓ already connected (${CLAUDE_FIRE_URL_SECRET} secret present).\n` +
                '  Live re-verification: fire a test run with `looper run groom --issue <n>`.\n' +
                '  To rotate the token: regenerate in Claude, then `looper connect claude --rotate`.',
            );
            return;
          }
        } catch {
          // gh unavailable or not in a repo — continue to the guided flow
        }
      }
      console.log(
        [
          'Connect Claude (subscription, manual routine import — one-time web setup):',
          '',
          '  1. In Claude (web): Claude Code → Routines → create a routine.',
          '     - Repository: select THIS repo (authorize Anthropic’s GitHub App if asked).',
          '     - Cloud environment: pick/create one. Project env vars + setup scripts',
          '       for the sandbox are configured THERE, in Claude — looper never',
          '       forwards Actions secrets at /fire time.',
          '     - Allow the routine to create branches / open PRs.',
          '  2. Add an **API trigger** to the routine. Claude shows a per-routine',
          '     fire URL and a bearer token (shown ONCE — copy both now).',
          '  3. Paste them below; they are stored as GitHub Actions secrets',
          `     ${CLAUDE_FIRE_URL_SECRET} / ${CLAUDE_FIRE_TOKEN_SECRET} via gh.`,
          '',
          'This uses your Claude subscription (no ANTHROPIC_API_KEY anywhere).',
          '',
          'Note: Zero-Data-Retention orgs cannot use Claude cloud routines, and',
          'tests needing live secrets/network may not run in provider sandboxes —',
          'those cases use the self-hosted backend instead:',
          '  looper connect default self-hosted',
          '',
        ].join('\n'),
      );

      if (!process.stdin.isTTY) {
        console.log(
          `non-interactive shell: set the secrets yourself —\n` +
            `  gh secret set ${CLAUDE_FIRE_URL_SECRET}\n  gh secret set ${CLAUDE_FIRE_TOKEN_SECRET}`,
        );
        return;
      }
      const { password, isCancel } = await import('@clack/prompts');
      const fireUrl = await password({ message: 'Routine fire URL:' });
      if (isCancel(fireUrl)) return;
      const fireToken = await password({ message: 'Routine bearer token:' });
      if (isCancel(fireToken)) return;

      const repoArgs = opts.repo ? ['--repo', opts.repo] : [];
      await ghSecretSet(CLAUDE_FIRE_URL_SECRET, String(fireUrl), repoArgs);
      await ghSecretSet(CLAUDE_FIRE_TOKEN_SECRET, String(fireToken), repoArgs);
      console.log(
        `✓ stored ${CLAUDE_FIRE_URL_SECRET} + ${CLAUDE_FIRE_TOKEN_SECRET} as Actions secrets.\n` +
          '  Rotation: regenerate the token in Claude, then re-run `looper connect claude`.',
      );
    });

  registerConnectDefault(connect);

  connect
    .command('codex')
    .description('authorize the OpenAI Codex GitHub App for this repository')
    .action(async () => {
      console.log(
        [
          'Connect Codex (subscription, provider App):',
          '',
          '  1. Sign in to Codex cloud with the ChatGPT account that holds the plan.',
          '  2. Install/authorize the OpenAI Codex GitHub App for this repository',
          '     (Codex cloud onboarding → GitHub).',
          '  3. The GitHub identity that posts @codex mentions must be CONNECTED to',
          '     that ChatGPT account — Codex resolves quota through the commenter.',
          '     For automation, that usually means a fine-grained PAT for your own',
          '     account stored as the LOOPER_CODEX_MENTION_TOKEN secret (a bot',
          '     identity with no linked ChatGPT account cannot trigger Codex).',
          '',
          'Verify: comment `@codex review` on any PR — Codex should react.',
          'No OpenAI API key is stored; usage bills to your subscription.',
        ].join('\n'),
      );
    });
}

export function registerConnectDefault(connect: Command): void {
  connect
    .command('default')
    .description('set the default execution backend in .looper/looper.yml')
    .argument('<backend>', 'claude | codex | self-hosted')
    .option('--path <dir>', 'repo root', '.')
    .action(async (backend: string, opts: { path: string }) => {
      if (!['claude', 'codex', 'self-hosted'].includes(backend)) {
        console.error(`invalid backend '${backend}' (claude | codex | self-hosted)`);
        process.exitCode = 1;
        return;
      }
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const file = join(opts.path, '.looper', 'looper.yml');
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        console.error(`no ${file} — run \`looper init\` first`);
        process.exitCode = 2;
        return;
      }
      const next = /^(\s*)default:\s*\S+(.*)$/m.test(text)
        ? text.replace(/^(\s*)default:\s*\S+(.*)$/m, `$1default: ${backend}$2`)
        : text.replace(/^backends:\s*$/m, `backends:\n  default: ${backend}`);
      await writeFile(file, next);
      const { loadConfig } = await import('@looper/config');
      const result = await loadConfig(opts.path);
      if (!result.ok) {
        console.error('edit left the config invalid — review .looper/looper.yml');
        process.exitCode = 1;
        return;
      }
      console.log(`✓ default backend set to '${backend}' (${file})`);
    });
}

async function ghSecretSet(name: string, value: string, extraArgs: string[]): Promise<void> {
  const child = execFileAsync('gh', ['secret', 'set', name, ...extraArgs, '--body', value]);
  await child;
}
