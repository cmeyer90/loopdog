import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ExecutionBackend,
  GitHubPort,
  LoopDefinition,
  RepoRef,
  RunRecord,
  TriggerEvent,
} from '@looper/core';
import {
  STATE_LABEL_PREFIX,
  resolveActorTrust,
  resolveAuthorizationPolicy,
  stateLabel,
} from '@looper/core';
import type { AuthorizationConfig } from '@looper/core';
import { loadConfig, parseDuration } from '@looper/config';
import { parseActionsEvent, resolveRepoIdentity } from '@looper/github';
import { RepoPlanStoreFiles, assertSupportedFormatVersion } from '@looper/plans';
import { createBackendRegistry } from '@looper/backends';
import type { PromptSource } from '@looper/backends';
import type { RunnerDeps } from './transition-runner.js';
import { runLoopOnce } from './transition-runner.js';
import { createPreflight } from './preflight.js';
import { matchLoopsForEvent } from '../triggers/match.js';
import { runSweep } from '../sweep/sweep.js';
import type { SweepSummary } from '../sweep/sweep.js';
import type { RunRecordStore } from '../telemetry/record-store.js';

/**
 * The controller composition root: what the Actions reusable workflows (and
 * `looper controller …`) invoke. Loads + validates config from the checked-out
 * repo, builds the runner deps, and drives one event or one sweep tick.
 */

export interface ControllerOptions {
  /** Checked-out repo root (config + prompt artifacts live here). */
  repoDir: string;
  repo: RepoRef;
  gh: GitHubPort;
  /** Empty/omitted = the default registry (claude/codex/self-hosted). */
  backends?: ReadonlyMap<string, ExecutionBackend>;
  records: RunRecordStore;
  /** Built-in templates dir (for prompt fallbacks); optional. */
  templatesDir?: string;
  botLogin?: string;
  now?: () => Date;
  /**
   * Invocation-unique claimant nonce (the event-vs-sweep double-dispatch
   * defense). Defaults to a random suffix; the simulation (0086) injects a
   * deterministic monotonic counter so runs are reproducible without
   * collapsing two racing claimants to one.
   */
  claimNonce?: () => string;
  /** One-invocation tighten-only override (0009). */
  forceDryRun?: boolean;
}

function identityFlags(eventPayload?: Record<string, unknown>) {
  try {
    const id = resolveRepoIdentity({ ...(eventPayload ? { eventPayload } : {}) });
    return { writable: id.writable, reTriggersWorkflows: id.reTriggersWorkflows };
  } catch {
    return undefined; // no ambient identity (tests inject their own gh)
  }
}

export interface EventResult {
  trigger: TriggerEvent;
  matchedLoops: string[];
  intake: boolean;
  records: RunRecord[];
}

export async function handleEvent(
  opts: ControllerOptions,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<EventResult> {
  const { config, deps } = await load(opts);
  const identity = identityFlags(payload);
  if (identity) deps.identity = identity;
  const now = opts.now?.() ?? new Date();
  const trigger = parseActionsEvent(eventName, payload, opts.repo, now.toISOString());

  // Intake: a human-opened issue enters the state machine as `new` so the
  // triage/groom loops can see it. Gated by the entry loop's mode (no writes
  // on a dry-run install).
  let intake = false;
  if (trigger.kind === 'event' && trigger.name === 'issues.opened' && trigger.item !== undefined) {
    const entryLoop = config.loops.find((l) => l.transition.from === 'new');
    if (entryLoop && entryLoop.mode === 'act') {
      const labels = await opts.gh.getItemLabels(trigger.item);
      if (!labels.some((l) => l.startsWith(STATE_LABEL_PREFIX))) {
        await opts.gh.addLabels(trigger.item, [stateLabel('new')]);
        intake = true;
      }
    }
  }

  // Trusted-only approval release (M17 · 0080): an untrusted actor applying
  // `looper:approved` does NOT release the hold — revoke the self-approval.
  if (
    trigger.kind === 'event' &&
    (trigger.name === 'issues.labeled' || trigger.name === 'pull_request.labeled') &&
    trigger.label === (config.root.authorization.approval_label ?? 'looper:approved') &&
    trigger.item !== undefined
  ) {
    const policy = resolveAuthorizationPolicy(toAuthorizationConfig(config.root.authorization));
    const trust = resolveActorTrust(policy, {
      login: trigger.actor?.login ?? 'unknown',
      isBot: trigger.actor?.type === 'Bot',
      association: trigger.authorAssociation ?? 'NONE',
    });
    if (!trust.trusted) {
      await opts.gh.removeLabel(trigger.item, config.root.authorization.approval_label);
      await opts.gh.createComment(
        trigger.item,
        `🔒 looper: \`${config.root.authorization.approval_label}\` from an untrusted actor ` +
          `(${trust.actor}) does not count — a collaborator must approve.`,
      );
    }
  }

  const item =
    trigger.kind === 'event' && trigger.item ? await opts.gh.getIssue(trigger.item) : undefined;
  const matched = matchLoopsForEvent(config.loops, trigger, item);
  const records: RunRecord[] = [];
  for (const loop of matched) {
    records.push(...(await runLoopOnce(deps, loop, opts.repo, trigger)));
  }
  return { trigger, matchedLoops: matched.map((l) => l.name), intake, records };
}

export async function handleSweep(opts: ControllerOptions): Promise<SweepSummary> {
  const { config, deps } = await load(opts);
  const interval = config.root.sweep.interval;
  const intervalMinutes = Math.max(1, Math.round(intervalToMinutes(interval)));
  return runSweep(deps, config.loops, opts.repo, {
    intervalMinutes,
    maxCandidatesPerTick: config.root.sweep.max_candidates_per_tick,
    maxCandidatesPerState: config.root.sweep.max_candidates_per_state,
  });
}

export interface RunResult {
  loop: string;
  found: boolean;
  records: RunRecord[];
}

/**
 * Manual targeted run (task 0070): drive one named loop now — over a single
 * item (`--issue`) or its whole from-state — honoring the same gates as an
 * automated run. `forceDryRun` (the CLI's `--dry-run`) can only tighten.
 */
export async function handleRun(
  opts: ControllerOptions,
  loopName: string,
  issue?: number,
): Promise<RunResult> {
  const { config, deps } = await load(opts);
  const loop = config.loops.find((l) => l.name === loopName);
  if (!loop) return { loop: loopName, found: false, records: [] };
  const at = (opts.now?.() ?? new Date()).toISOString();
  let trigger: TriggerEvent;
  if (issue !== undefined) {
    // A manual `looper run --issue` is invoked by a human holding a repo-scoped
    // token — they could mutate the repo directly — so attribute the trigger to
    // that authenticated actor instead of leaving it unknown/NONE, which the
    // authorization gate (M17) would park as an "untrusted trigger". Mirrors
    // `looper approve`, where the CLI operator releases holds as a trusted actor.
    const actor = await opts.gh.getAuthenticatedActor();
    trigger = {
      kind: 'event',
      name: 'manual.run',
      item: { ...opts.repo, number: issue },
      actor: { login: actor.login, type: 'User' },
      authorAssociation: actor.login === opts.repo.owner ? 'OWNER' : 'COLLABORATOR',
      deliveredAt: at,
    };
  } else {
    // Whole-from-state run: a cron-kind trigger is trusted by construction.
    trigger = { kind: 'cron', deliveredAt: at };
  }
  const records = await runLoopOnce(deps, loop, opts.repo, trigger);
  return { loop: loopName, found: true, records };
}

async function load(opts: ControllerOptions): Promise<{
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>['config']>;
  deps: RunnerDeps;
}> {
  const result = await loadConfig(opts.repoDir);
  if (!result.ok || !result.config) {
    const lines = result.errors.map(
      (e) => `  - ${e.file}${e.path ? ` (${e.path})` : ''}: ${e.message}`,
    );
    throw new Error(`looper config invalid:\n${lines.join('\n')}`);
  }
  const planStoreCfg = result.config.root.plan_store;
  assertSupportedFormatVersion(planStoreCfg.format_version);
  const meta = await opts.gh.getRepoMeta(opts.repo);
  const planFiles = new RepoPlanStoreFiles(
    opts.gh,
    opts.repo,
    meta.defaultBranch,
    planStoreCfg.path,
  );
  const backends =
    opts.backends && opts.backends.size > 0
      ? opts.backends
      : createBackendRegistry({
          gh: opts.gh,
          selfHosted: { defaultBranch: meta.defaultBranch },
        });
  const deps: RunnerDeps = {
    gh: opts.gh,
    backends,
    records: opts.records,
    table: result.config.table,
    readPrompt: (loop: LoopDefinition) => readPromptFile(opts.repoDir, loop),
    promptSource: createFsPromptSource(opts.repoDir, opts.templatesDir),
    planFiles,
    defaultBranch: meta.defaultBranch,
    extraChecks: createPreflight({
      gh: opts.gh,
      records: opts.records,
      backends,
      repo: opts.repo,
      config: {
        budgets: result.config.root.budgets,
        kill_switch: result.config.root.kill_switch,
        quota: result.config.root.quota,
        authorization: toAuthorizationConfig(result.config.root.authorization),
      },
      ...(opts.now ? { now: opts.now } : {}),
    }),
    ...(opts.botLogin ? { botLogin: opts.botLogin } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.claimNonce ? { claimNonce: opts.claimNonce } : {}),
    ...(opts.forceDryRun ? { forceDryRun: true } : {}),
  };
  return { config: result.config, deps };
}

async function readPromptFile(repoDir: string, loop: LoopDefinition): Promise<string> {
  return readFile(join(repoDir, loop.promptPath), 'utf8');
}

/** Layered prompt source over the checked-out repo (+ shipped templates). */
export function createFsPromptSource(repoDir: string, templatesDir?: string): PromptSource {
  const tryRead = (path: string) =>
    readFile(path, 'utf8').then(
      (t) => t,
      () => null,
    );
  return {
    builtin: (loop) =>
      templatesDir
        ? tryRead(join(templatesDir, 'loops', loop, 'prompt.md'))
        : Promise.resolve(null),
    repo: (loop) => tryRead(join(repoDir, '.looper', 'loops', loop, 'prompt.md')),
    overlay: (loop, backend) =>
      tryRead(join(repoDir, '.looper', 'loops', loop, `prompt.${backend}.md`)),
    policy: (name) => tryRead(join(repoDir, '.looper', 'policies', `${name}.md`)),
  };
}

/** Map the snake_case root authorization config to the core camelCase shape. */
function toAuthorizationConfig(a: {
  actors: 'anyone' | 'org-members' | 'collaborators' | 'allowlist';
  allow: string[];
  deny: string[];
  on_unauthorized: 'park' | 'ignore' | 'comment';
  approval_label: string;
  allowed_bots: string[];
  rate_limit?:
    | { per_actor_per_day?: number | undefined; global_per_hour?: number | undefined }
    | undefined;
  schedule_window?:
    | { days?: string[] | undefined; hours?: string | undefined; tz?: string | undefined }
    | undefined;
}): AuthorizationConfig {
  return {
    actors: a.actors,
    allow: a.allow,
    deny: a.deny,
    onUnauthorized: a.on_unauthorized,
    approvalLabel: a.approval_label,
    allowedBots: a.allowed_bots,
    rateLimit: a.rate_limit
      ? {
          perActorPerDay: a.rate_limit.per_actor_per_day,
          globalPerHour: a.rate_limit.global_per_hour,
        }
      : undefined,
    scheduleWindow: a.schedule_window,
  };
}

// '*/5 * * * *' → 5; friendly and fixed-time intervals → the sweep default 5.
function intervalToMinutes(interval: string): number {
  const m = interval.trim().match(/^\*\/(\d+)\s/);
  if (m) return Number(m[1]);
  const dur = parseDuration(interval);
  if (dur > 0) return dur / 60;
  return 5;
}
