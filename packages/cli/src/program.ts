import { Command } from 'commander';
import { createRequire } from 'node:module';
import type { ExecutionBackend } from '@loopdog/core';
import { registerInit } from './commands/init.js';
import { registerController } from './commands/controller.js';
import { registerLogin } from './commands/login.js';
import { registerConnect } from './commands/connect.js';
import { registerPromote } from './commands/promote.js';
import { registerConfig } from './commands/config.js';
import { registerPrompts } from './commands/prompts.js';
import { registerLoops } from './commands/loops.js';
import { registerRuns } from './commands/runs.js';
import { registerStatus } from './commands/status.js';
import { registerRun } from './commands/run.js';
import { registerBench } from './commands/bench.js';
import { registerUpgrade } from './commands/upgrade.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * Builds the `loopdog` command tree. Execution backends are injected so the
 * registry (M05, `@loopdog/backends`) stays the single source for them.
 */
export function buildProgram(backends: ReadonlyMap<string, ExecutionBackend> = new Map()): Command {
  const program = new Command();
  program
    .name('loopdog')
    .description(
      'Autonomous-SDLC loops for any GitHub repository, driven by your existing ' +
        'Claude Code and Codex subscriptions.',
    )
    .version(version, '-V, --version', 'output the loopdog version');

  registerLogin(program);
  registerInit(program);
  registerConnect(program);
  registerConfig(program);
  registerPrompts(program);
  registerPromote(program);
  registerLoops(program);
  registerRuns(program);
  registerStatus(program);
  registerRun(program);
  registerBench(program);
  registerUpgrade(program);
  registerController(program, backends);
  return program;
}
