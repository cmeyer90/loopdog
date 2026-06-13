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
import { STATE_LABEL_PREFIX, stateLabel } from '@looper/core';
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
  const trigger: TriggerEvent =
    issue !== undefined
      ? {
          kind: 'event',
          name: 'manual.run',
          item: { ...opts.repo, number: issue },
          deliveredAt: (opts.now?.() ?? new Date()).toISOString(),
        }
      : { kind: 'cron', deliveredAt: (opts.now?.() ?? new Date()).toISOString() };
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
      },
      ...(opts.now ? { now: opts.now } : {}),
    }),
    ...(opts.botLogin ? { botLogin: opts.botLogin } : {}),
    ...(opts.now ? { now: opts.now } : {}),
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

// '*/5 * * * *' → 5; friendly and fixed-time intervals → the sweep default 5.
function intervalToMinutes(interval: string): number {
  const m = interval.trim().match(/^\*\/(\d+)\s/);
  if (m) return Number(m[1]);
  const dur = parseDuration(interval);
  if (dur > 0) return dur / 60;
  return 5;
}
