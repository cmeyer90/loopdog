/**
 * The project-adapter port (M06 · 0024): `detect / build / test / lint / run /
 * deploy` — the one contract that lets looper describe and operate an
 * arbitrary project. Adapters describe WHAT to run; `@looper/runtime` owns HOW
 * (the injected `CommandRunner`) — so core stays IO-free and adapters never
 * spawn processes directly.
 */
export interface ProjectAdapter {
  /** "node" | "python" | "generic" | a third-party name. */
  readonly name: string;
  /** Confidence this adapter fits the repo (read-only view; pure). */
  detect(repo: RepoFs): Promise<DetectResult>;
  /** Which phases this adapter supports for the detected/configured project. */
  capabilities(): AdapterCapabilities;
  build(ctx: CommandContext): Promise<CommandResult>;
  test(ctx: CommandContext): Promise<CommandResult>;
  lint(ctx: CommandContext): Promise<CommandResult>;
  /** Start the app (the smoke target, M11). */
  run(ctx: CommandContext): Promise<CommandResult>;
  deploy(ctx: CommandContext): Promise<CommandResult>;
  /** Human/brief-readable command summary (surfaced in composed briefs). */
  describe(): AdapterDescription;
}

export type AdapterPhase = 'build' | 'test' | 'lint' | 'run' | 'deploy';

export interface DetectResult {
  matched: boolean;
  /** 0..1 */
  confidence: number;
  /** Human-readable evidence, e.g. ["package.json present", "pnpm-lock.yaml → pnpm"]. */
  evidence: string[];
  /** Resolved hints, e.g. { packageManager: "pnpm" }. */
  toolchain?: Record<string, string> | undefined;
}

export interface AdapterCapabilities {
  build: boolean;
  test: boolean;
  lint: boolean;
  run: boolean;
  deploy: boolean;
}

export interface AdapterDescription {
  /** The literal command per supported phase (what CI and the work cell run). */
  commands: Partial<Record<AdapterPhase, string>>;
  /** Dependency-install step CI/briefs should run first, when applicable. */
  install?: string | undefined;
}

/** Normalized result every lifecycle method returns. */
export interface CommandResult {
  /** Exit code 0 (or adapter-defined success). Skipped phases are ok:true. */
  ok: boolean;
  /** Captured stdout+stderr tail (for run records / briefs). */
  output: string;
  durationMs: number;
  /** Raw exit code when a process ran; absent for skip. */
  exitCode?: number | undefined;
  /** Adapter has no command for this phase (non-blocking pass). */
  skipped?: boolean | undefined;
}

export interface CommandContext {
  /** Absolute path to the checked-out repo. */
  workdir: string;
  env?: Record<string, string> | undefined;
  /** Injected exec — adapters never spawn directly. */
  run: CommandRunner;
  signal?: AbortSignal | undefined;
}

export type CommandRunner = (
  argv: string[],
  opts: { cwd: string; env?: Record<string, string> | undefined; signal?: AbortSignal | undefined },
) => Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;

/** Read-only repo view injected into `detect()` (keeps the port IO-free). */
export interface RepoFs {
  exists(path: string): Promise<boolean>;
  /** null when the file does not exist. */
  read(path: string): Promise<string | null>;
  /** Immediate entries of a directory; [] when missing. */
  list(dir: string): Promise<string[]>;
}

/** A skipped phase result (the uniform "no command for this phase" answer). */
export function skippedResult(phase: AdapterPhase): CommandResult {
  return { ok: true, output: `no ${phase} command`, durationMs: 0, skipped: true };
}
