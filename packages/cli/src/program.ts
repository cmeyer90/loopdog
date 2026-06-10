import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/** Builds the `looper` command tree. Subcommands are registered by their milestone slices. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('looper')
    .description(
      'Autonomous-SDLC loops for any GitHub repository, driven by your existing ' +
        'Claude Code and Codex subscriptions.',
    )
    .version(version, '-V, --version', 'output the looper version');
  return program;
}
