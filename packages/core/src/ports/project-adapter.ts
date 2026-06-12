/**
 * The project-adapter port (M06): describes an arbitrary project to the work
 * cell and to verification — `detect / build / test / lint / run / deploy`.
 * Adapters *describe* commands; execution happens in the provider sandbox or
 * the adopter's CI/runner, never inside `@looper/core`.
 */
export interface ProjectAdapter {
  readonly id: AdapterId;
  /**
   * Inspect the repo (read-only) and return a profile when this adapter
   * recognizes the stack, or null to pass.
   */
  detect(fs: RepoFs): Promise<ProjectProfile | null>;
  /** The command plan for a recognized project. */
  commands(profile: ProjectProfile): AdapterCommands;
}

export type AdapterId = 'node' | 'python' | 'generic' | (string & {});

/** Read-only repo view injected into `detect()` (declared here per 0094). */
export interface RepoFs {
  readFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** Immediate entries of a directory; [] when missing. */
  list(dir: string): Promise<string[]>;
}

export interface ProjectProfile {
  adapter: AdapterId;
  /** Human-readable stack summary, e.g. "node 20 / npm workspaces / vitest". */
  summary: string;
  /** Adapter-specific facts (package manager, tool names, …). */
  facts: Record<string, string>;
}

export interface AdapterCommands {
  build?: CommandPlan | undefined;
  test?: CommandPlan | undefined;
  lint?: CommandPlan | undefined;
  run?: CommandPlan | undefined;
  deploy?: DeployPlan | undefined;
}

export interface CommandPlan {
  steps: CommandStep[];
}

export interface CommandStep {
  name: string;
  /** A shell command line. */
  run: string;
  /** Env var NAMES the step needs (values resolve via the secret plane, M07). */
  env?: string[] | undefined;
}

export interface DeployPlan extends CommandPlan {
  /** Post-deploy smoke/health assertions (M11). */
  smoke?: CommandPlan | undefined;
  rollback?: CommandPlan | undefined;
}
