import type {
  AdapterCapabilities,
  AdapterDescription,
  AdapterPhase,
  CommandContext,
  CommandResult,
  DetectResult,
  ProjectAdapter,
  RepoFs,
} from '@looper/core';
import { skippedResult } from '@looper/core';

/**
 * The Node adapter (task 0027): detects via package.json (+ lockfile → package
 * manager) and prefers the project's own `scripts`. Commands are overridable
 * via `adapter_options.commands` (precedence: override > scripts-derived >
 * manager default).
 */

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface NodeAdapterOptions {
  packageManager?: PackageManager | undefined;
  commands?: Partial<Record<AdapterPhase, string | string[] | null>> | undefined;
}

interface Profile {
  pm: PackageManager;
  scripts: Record<string, string>;
  main?: string | undefined;
}

export class NodeAdapter implements ProjectAdapter {
  readonly name = 'node';
  private profile: Profile = { pm: 'npm', scripts: {} };

  constructor(private readonly options: NodeAdapterOptions = {}) {}

  async detect(repo: RepoFs): Promise<DetectResult> {
    const pkgRaw = await repo.read('package.json');
    if (pkgRaw === null) {
      return { matched: false, confidence: 0, evidence: ['no package.json'] };
    }
    const evidence = ['package.json present'];
    let confidence = 0.7;

    let pm: PackageManager = this.options.packageManager ?? 'npm';
    const locks: Array<[string, PackageManager]> = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
      ['package-lock.json', 'npm'],
    ];
    for (const [file, manager] of locks) {
      if (await repo.exists(file)) {
        if (!this.options.packageManager) pm = manager;
        evidence.push(`${file} → ${manager}`);
        confidence = 0.9;
        break;
      }
    }

    let scripts: Record<string, string> = {};
    let main: string | undefined;
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; main?: string };
      scripts = pkg.scripts ?? {};
      main = pkg.main;
    } catch {
      evidence.push('package.json unparseable (still counts as a marker)');
    }
    this.profile = { pm, scripts, main };
    return { matched: true, confidence, evidence, toolchain: { packageManager: pm } };
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
    const { pm } = this.profile;
    return { commands, install: pm === 'npm' ? 'npm ci' : `${pm} install` };
  }

  /** Precedence: explicit override > package.json scripts > manager default. */
  private command(phase: AdapterPhase): string | string[] | null {
    const override = this.options.commands?.[phase];
    if (override !== undefined) return override;
    const { pm, scripts, main } = this.profile;
    const runScript = (s: string) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
    switch (phase) {
      case 'build':
        return scripts['build'] ? runScript('build') : null;
      case 'test':
        return scripts['test'] ? (pm === 'yarn' ? 'yarn test' : `${pm} test`) : null;
      case 'lint':
        return scripts['lint'] ? runScript('lint') : null;
      case 'run':
        if (scripts['start']) return pm === 'npm' ? 'npm start' : `${pm} start`;
        return main ? `node ${main}` : null;
      case 'deploy':
        return null; // deploy is project-specific — config/0026 territory
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
