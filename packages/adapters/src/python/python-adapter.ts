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
 * The Python adapter (task 0027): detects via pyproject.toml (primary) or
 * requirements.txt/setup.py/Pipfile, picks the runner family (uv/poetry/pip),
 * and prefers pytest/ruff when configured.
 */

type Runner = 'uv' | 'poetry' | 'pip';

export interface PythonAdapterOptions {
  runner?: Runner | undefined;
  commands?: Partial<Record<AdapterPhase, string | string[] | null>> | undefined;
}

interface Profile {
  runner: Runner;
  hasPyproject: boolean;
  hasPytest: boolean;
  hasRuff: boolean;
}

export class PythonAdapter implements ProjectAdapter {
  readonly name = 'python';
  private profile: Profile = {
    runner: 'pip',
    hasPyproject: false,
    hasPytest: false,
    hasRuff: false,
  };

  constructor(private readonly options: PythonAdapterOptions = {}) {}

  async detect(repo: RepoFs): Promise<DetectResult> {
    const pyproject = await repo.read('pyproject.toml');
    const evidence: string[] = [];
    let confidence = 0;
    let matched = false;

    if (pyproject !== null) {
      matched = true;
      confidence = 0.9;
      evidence.push('pyproject.toml present');
    } else {
      for (const marker of ['requirements.txt', 'setup.py', 'Pipfile']) {
        if (await repo.exists(marker)) {
          matched = true;
          confidence = Math.max(confidence, 0.6);
          evidence.push(`${marker} present`);
        }
      }
    }
    if (!matched) return { matched, confidence: 0, evidence: ['no python markers'] };

    let runner: Runner = this.options.runner ?? 'pip';
    if (!this.options.runner) {
      if (await repo.exists('uv.lock')) runner = 'uv';
      else if (pyproject?.includes('[tool.poetry]')) runner = 'poetry';
    }
    if (runner !== 'pip') evidence.push(`runner → ${runner}`);

    this.profile = {
      runner,
      hasPyproject: pyproject !== null,
      hasPytest:
        pyproject?.includes('pytest') === true ||
        (await repo.exists('pytest.ini')) ||
        (await repo.exists('tests')),
      hasRuff: pyproject?.includes('[tool.ruff]') === true || (await repo.exists('ruff.toml')),
    };
    return { matched, confidence, evidence, toolchain: { runner } };
  }

  capabilities(): AdapterCapabilities {
    return {
      build: this.command('build') != null,
      test: this.command('test') != null,
      lint: this.command('lint') != null,
      run: this.command('run') != null,
      deploy: this.command('deploy') != null,
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
      const cmd = this.command(phase);
      if (cmd != null) commands[phase] = Array.isArray(cmd) ? cmd.join(' ') : cmd;
    }
    const install =
      this.profile.runner === 'uv'
        ? 'uv sync'
        : this.profile.runner === 'poetry'
          ? 'poetry install'
          : 'pip install -r requirements.txt';
    return { commands, install };
  }

  /** Precedence: explicit override > pyproject-derived > runner default. */
  private command(phase: AdapterPhase): string | string[] | null {
    const override = this.options.commands?.[phase];
    if (override !== undefined) return override;
    const { runner, hasPyproject, hasPytest, hasRuff } = this.profile;
    const prefix = runner === 'uv' ? 'uv run ' : runner === 'poetry' ? 'poetry run ' : '';
    switch (phase) {
      case 'build':
        return hasPyproject
          ? runner === 'uv'
            ? 'uv build'
            : runner === 'poetry'
              ? 'poetry build'
              : null
          : null;
      case 'test':
        return hasPytest ? `${prefix}pytest -q` : 'python -m unittest discover';
      case 'lint':
        return hasRuff ? `${prefix}ruff check .` : null;
      case 'run':
        return null; // entrypoints vary too much — config territory
      case 'deploy':
        return null;
    }
  }

  private async exec(phase: AdapterPhase, ctx: CommandContext): Promise<CommandResult> {
    const cmd = this.command(phase);
    if (cmd == null) return skippedResult(phase);
    const argv = Array.isArray(cmd) ? cmd : ['/bin/sh', '-c', cmd];
    const result = await ctx.run(argv, { cwd: ctx.workdir, env: ctx.env, signal: ctx.signal });
    return {
      ok: result.exitCode === 0,
      output: `${result.stdout}\n${result.stderr}`.trim().slice(-8192),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
    };
  }
}
