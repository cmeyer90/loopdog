import type { BackendId } from '../ports/backend.js';
import type { Mode } from '../gates/mode.js';

/**
 * The domain shape of a declared loop ("loops are data, not code"): the parsed
 * form of `.looper/loops/<name>/loop.yml`. `@looper/config` owns parsing and
 * validation into this type; the runtime executes any value of it generically.
 */
export interface LoopDefinition {
  name: string;
  trigger: LoopTrigger;
  /**
   * The transition this loop drives. `fallback` is the alternate landing
   * state for verdict/check-gated loops (review -> changes-requested, deploy
   * smoke -> deploy-failed); it must also be a legal edge.
   */
  transition: { from: string; to: string; fallback?: string | undefined };
  backend: BackendId;
  /** Reviewer backend when this loop reviews (cross-provider rule, M10/M13). */
  reviewBackend?: BackendId | undefined;
  gates: GateConfig;
  blastRadius?: BlastRadiusConfig | undefined;
  authorization?: AuthorizationConfig | undefined;
  resilience?: ResilienceConfig | undefined;
  /** Repo-relative path of the loop's prompt artifact. */
  promptPath: string;
  /** dry-run = comment-only, never relabel/dispatch side effects (M02 · 0009). */
  mode: LoopMode;
  /**
   * What the dispatched work cell produces. Undefined = a deterministic
   * transition with no work cell (e.g. merge), applied inline by the runner.
   */
  expects?: 'pull-request' | 'comment' | 'plan-update' | undefined;
  /** Advisory same-area serialization key (task 0013 `serialize_by`). */
  serializeBy?: string | undefined;
  /** Work-cell needs, checked against backend capabilities (0021 mismatch). */
  requires?: { liveSecrets?: boolean | undefined; network?: boolean | undefined } | undefined;
  /** Dual-attempt + judge for high-risk work (M13 - 0055; tier:core only). */
  ensemble?: { enabled: boolean; judge?: string | undefined } | undefined;
}

export type LoopMode = Mode;

/** The only two trigger kinds: GitHub events or cron. */
export type LoopTrigger =
  | {
      kind: 'github_event';
      /** Normalized names, e.g. 'issues.labeled' (or bare 'status'). */
      events: string[];
      /** e.g. { merged: true } — the synthetic merge source (0008). */
      predicate?: Record<string, unknown> | undefined;
      /** Optional actor/label filters. */
      filter?: { author?: string | undefined; label?: string | undefined } | undefined;
    }
  | { kind: 'cron'; schedule: string };

export type RiskTier = 'safe' | 'default' | 'core';

export interface GateConfig {
  requireDor: boolean;
  requireCi: boolean;
  tier: RiskTier;
  /** Required check contexts beyond the repo's protected ones (0041). */
  requiredChecks?: string[] | undefined;
}

export interface BlastRadiusConfig {
  maxFiles?: number | undefined;
  maxDiffLines?: number | undefined;
  /** Paths the loop must never touch (glob patterns). */
  forbiddenPaths?: string[] | undefined;
}

/** WHO/WHAT/WHEN trigger control (M17). Strictest applicable rule wins. */
export interface AuthorizationConfig {
  actors: 'anyone' | 'org-members' | 'collaborators' | 'allowlist';
  allow?: string[] | undefined;
  deny?: string[] | undefined;
  onUnauthorized: 'park' | 'ignore' | 'comment';
  approvalLabel?: string | undefined;
  allowedBots?: string[] | undefined;
  /** WHAT (0081): event selectors this loop acts on beyond its trigger. */
  triggerSources?: string[] | undefined;
  botAllow?: string[] | undefined;
  botDeny?: string[] | undefined;
  rateLimit?:
    | { perActorPerDay?: number | undefined; globalPerHour?: number | undefined }
    | undefined;
  scheduleWindow?:
    | { days?: string[] | undefined; hours?: string | undefined; tz?: string | undefined }
    | undefined;
}

/** Failure-policy knobs (M19). All optional — defaults ship in config. */
export interface ResilienceConfig {
  retries?:
    | { max: number; backoff: 'exponential' | 'fixed'; baseSeconds: number; capSeconds: number }
    | undefined;
  dispatchTimeoutMinutes?: number | undefined;
  maxAttemptsPerItem?: number | undefined;
  maxFixAttempts?: number | undefined;
  maxInFlight?: { global?: number | undefined; perLoop?: number | undefined } | undefined;
  circuitBreaker?: { consecutiveFailures: number; cooldownMinutes: number } | undefined;
  onFailure?: 'needs-human' | 'retry' | 'abandon' | undefined;
  escalateTo?: string | undefined;
}
