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
import { parseActionsEvent } from '@looper/github';
import type { RunnerDeps } from './transition-runner.js';
import { runLoopOnce } from './transition-runner.js';
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
  backends: ReadonlyMap<string, ExecutionBackend>;
  records: RunRecordStore;
  botLogin?: string;
  now?: () => Date;
  /** One-invocation tighten-only override (0009). */
  forceDryRun?: boolean;
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
  const deps: RunnerDeps = {
    gh: opts.gh,
    backends: opts.backends,
    records: opts.records,
    table: result.config.table,
    readPrompt: (loop: LoopDefinition) => readPromptFile(opts.repoDir, loop),
    ...(opts.botLogin ? { botLogin: opts.botLogin } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.forceDryRun ? { forceDryRun: true } : {}),
  };
  return { config: result.config, deps };
}

async function readPromptFile(repoDir: string, loop: LoopDefinition): Promise<string> {
  return readFile(join(repoDir, loop.promptPath), 'utf8');
}

// '*/5 * * * *' → 5; friendly and fixed-time intervals → the sweep default 5.
function intervalToMinutes(interval: string): number {
  const m = interval.trim().match(/^\*\/(\d+)\s/);
  if (m) return Number(m[1]);
  const dur = parseDuration(interval);
  if (dur > 0) return dur / 60;
  return 5;
}
