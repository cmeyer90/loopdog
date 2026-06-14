import type {
  AdapterCapabilities,
  AdapterDescription,
  AdapterPhase,
  CommandContext,
  CommandResult,
  DetectResult,
  ProjectAdapter,
  RepoFs,
} from '@loopdog/core';
import { skippedResult } from '@loopdog/core';

/**
 * The generic command adapter (task 0026): the config-driven escape hatch that
 * guarantees NO project is unsupported. Each phase runs exactly the command
 * the adopter configured; unset phases skip. Never auto-claims a repo —
 * selection picks it explicitly or as the detection floor (0025).
 */

export type CommandSpec = string | string[];

export interface GenericAdapterOptions {
  commands?: Partial<Record<AdapterPhase, CommandSpec | null>> | undefined;
  /** Shell used for string commands; array commands exec directly (no shell). */
  shell?: string[] | undefined;
  env?: Record<string, string> | undefined;
}

const OUTPUT_TAIL_BYTES = 8 * 1024;

export class GenericCommandAdapter implements ProjectAdapter {
  readonly name = 'generic';
  constructor(private readonly options: GenericAdapterOptions = {}) {}

  async detect(_repo: RepoFs): Promise<DetectResult> {
    // The generic adapter never claims a repo; it is the explicit fallback.
    return { matched: false, confidence: 0, evidence: ['generic adapter never auto-claims'] };
  }

  capabilities(): AdapterCapabilities {
    const has = (phase: AdapterPhase) => this.spec(phase) != null;
    return {
      build: has('build'),
      test: has('test'),
      lint: has('lint'),
      run: has('run'),
      deploy: has('deploy'),
    };
  }

  build(ctx: CommandContext): Promise<CommandResult> {
    return this.exec('build', ctx);
  }
  test(ctx: CommandContext): Promise<CommandResult> {
    return this.exec('test', ctx);
  }
  lint(ctx: CommandContext): Promise<CommandResult> {
    return this.exec('lint', ctx);
  }
  run(ctx: CommandContext): Promise<CommandResult> {
    return this.exec('run', ctx);
  }
  deploy(ctx: CommandContext): Promise<CommandResult> {
    return this.exec('deploy', ctx);
  }

  describe(): AdapterDescription {
    const commands: AdapterDescription['commands'] = {};
    for (const phase of ['build', 'test', 'lint', 'run', 'deploy'] as const) {
      const spec = this.spec(phase);
      if (spec != null) commands[phase] = Array.isArray(spec) ? spec.join(' ') : spec;
    }
    return { commands };
  }

  private spec(phase: AdapterPhase): CommandSpec | null {
    return this.options.commands?.[phase] ?? null;
  }

  private async exec(phase: AdapterPhase, ctx: CommandContext): Promise<CommandResult> {
    const spec = this.spec(phase);
    if (spec == null) return skippedResult(phase);
    // Array commands exec directly (no shell, no word-splitting — injection
    // safe); string commands run through the configured shell.
    const argv = Array.isArray(spec) ? spec : [...(this.options.shell ?? ['/bin/sh', '-c']), spec];
    const result = await ctx.run(argv, {
      cwd: ctx.workdir,
      env: { ...this.options.env, ...ctx.env },
      signal: ctx.signal,
    });
    return {
      ok: result.exitCode === 0,
      output: tail(`${result.stdout}\n${result.stderr}`.trim()),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
    };
  }
}

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL_BYTES ? text : text.slice(-OUTPUT_TAIL_BYTES);
}
