import { Command } from 'commander';
import type { ExecutionBackend } from '@loopdog/core';
import { CLI_VERSION } from './version.js';
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
import { registerWorkflows } from './commands/workflows.js';
import { registerBench } from './commands/bench.js';
import { registerUpgrade } from './commands/upgrade.js';

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
    .version(CLI_VERSION, '-V, --version', 'output the loopdog version');

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
  registerWorkflows(program);
  registerBench(program);
  registerUpgrade(program);
  registerController(program, backends);
  return program;
}
