import type { IssueSnapshot, LoopDefinition, RepoRef, RunRecord } from '@loopdog/core';
import {
  NOT_BEFORE_PREFIX,
  OFF_RAMP_LABELS,
  STATE_LABEL_PREFIX,
  parseNotBefore,
  stateLabel,
} from '@loopdog/core';
import { isCronDue } from '@loopdog/config';
import { clearExpiredClaim } from '@loopdog/github';
import type { RunnerDeps } from '../pipeline/transition-runner.js';
import { runLoopOnItem, scanStates } from '../pipeline/transition-runner.js';

/**
 * The cron reconcile sweep (task 0076): the resilience half of the
 * dual-trigger model. One scheduled pass that (1) recovers items a dropped
 * webhook stranded, (2) carries controller→controller handoffs the
 * `GITHUB_TOKEN` no-retrigger rule leaves behind, and (3) drives time-based
 * transitions (lease reclaim, cron-due loops, hold retries). Read-mostly; an
 * empty tick makes no provider dispatch.
 */

export interface SweepOptions {
  intervalMinutes: number;
  maxCandidatesPerTick: number;
  maxCandidatesPerState: number;
}

export interface SweepSummary {
  scannedStates: string[];
  reclaimedLeases: number;
  candidates: number;
  processed: Array<{ loop: string; item: number; status: string }>;
  /** Candidates dropped by caps — deferred to later ticks, never silent. */
  deferredByCap: number;
  skipped: Array<{ item: number; reason: string }>;
  records: RunRecord[];
}

export async function runSweep(
  deps: RunnerDeps,
  loops: readonly LoopDefinition[],
  repo: RepoRef,
  opts: SweepOptions,
): Promise<SweepSummary> {
  const now = deps.now?.() ?? new Date();
  const summary: SweepSummary = {
    scannedStates: [],
    reclaimedLeases: 0,
    candidates: 0,
    processed: [],
    deferredByCap: 0,
    skipped: [],
    records: [],
  };

  // Group loops by every state they drive (from-state + the dispatched
  // intermediate for work-cell loops); scan each distinct state once.
  const byState = new Map<string, LoopDefinition[]>();
  for (const loop of loops) {
    for (const state of scanStates(loop, deps.table)) {
      const list = byState.get(state) ?? [];
      if (!list.includes(loop)) list.push(loop);
      byState.set(state, list);
    }
  }
  const stateOrder = [...deps.table.states.filter((s) => byState.has(s))];

  const candidates: Array<{ loop: LoopDefinition; item: IssueSnapshot }> = [];
  for (const state of stateOrder) {
    summary.scannedStates.push(state);
    const stateLoops = (byState.get(state) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    let items = await deps.gh.listIssuesByLabel(repo, stateLabel(state));
    items = items.sort(
      (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.ref.number - b.ref.number,
    );

    let perState = 0;
    for (const item of items) {
      // Timer maintenance first: reclaim crashed runs' expired leases.
      if (await clearExpiredClaim(deps.gh, item.ref, now)) {
        summary.reclaimedLeases++;
        item.labels = await deps.gh.getItemLabels(item.ref);
      }

      // Backoff timers (0051): a passed not-before clears; a future one skips.
      const notBefore = parseNotBefore(item.labels);
      if (notBefore !== null) {
        if (Date.parse(notBefore) > now.getTime()) {
          summary.skipped.push({ item: item.ref.number, reason: `backoff until ${notBefore}` });
          continue;
        }
        await deps.gh.removeLabel(item.ref, `${NOT_BEFORE_PREFIX}${notBefore}`);
        item.labels = item.labels.filter((l) => !l.startsWith(NOT_BEFORE_PREFIX));
      }

      // Parked holds (0050/0075): retryAfter passed → unpark and re-evaluate
      // through the pre-flight; kill-switch/approval holds have no retryAfter.
      if (item.labels.includes('loopdog:parked')) {
        const hold = await readHoldMarker(deps, item);
        if (hold?.retryAfter && Date.parse(hold.retryAfter) <= now.getTime()) {
          await deps.gh.removeLabel(item.ref, 'loopdog:parked');
          item.labels = item.labels.filter((l) => l !== 'loopdog:parked');
        }
      }

      const skip = preFilter(item);
      if (skip) {
        summary.skipped.push({ item: item.ref.number, reason: skip });
        continue;
      }

      for (const loop of stateLoops) {
        if (
          loop.trigger.kind === 'cron' &&
          !isCronDue(loop.trigger.schedule, now, opts.intervalMinutes)
        ) {
          continue; // cron loop not due this tick
        }
        if (
          perState >= opts.maxCandidatesPerState ||
          candidates.length >= opts.maxCandidatesPerTick
        ) {
          summary.deferredByCap++;
          continue;
        }
        candidates.push({ loop, item });
        perState++;
      }
    }
  }
  summary.candidates = candidates.length;

  // Process in the stable order; one transition per item per tick.
  const actedItems = new Set<number>();
  for (const { loop, item } of candidates) {
    if (actedItems.has(item.ref.number)) continue;
    const record = await runLoopOnItem(deps, loop, item, {
      kind: 'cron',
      deliveredAt: now.toISOString(),
    });
    if (record) {
      summary.records.push(record);
      summary.processed.push({
        loop: loop.name,
        item: item.ref.number,
        status: record.outcome.status,
      });
      actedItems.add(item.ref.number);
    }
  }
  return summary;
}

/**
 * Durable "not yet" pre-filter (final gates are the runner's pre-flight).
 * Returns the skip reason, or null when the item is a candidate.
 */
async function readHoldMarker(
  deps: RunnerDeps,
  item: IssueSnapshot,
): Promise<{ reason: string; retryAfter: string | null } | null> {
  const comments = await deps.gh.listComments(item.ref);
  for (const comment of [...comments].reverse()) {
    const m = comment.body.match(/<!-- loopdog:hold (\{.*?\}) -->/);
    if (m) {
      try {
        return JSON.parse(m[1]!) as { reason: string; retryAfter: string | null };
      } catch {
        return null; // malformed hold → fail toward skip-and-report
      }
    }
  }
  return null;
}

function preFilter(item: IssueSnapshot): string | null {
  const lifecycle = item.labels.filter((l) => l.startsWith(STATE_LABEL_PREFIX));
  if (lifecycle.length === 0) return 'no lifecycle label';
  if (lifecycle.length > 1) return `multiple lifecycle labels: ${lifecycle.join(', ')}`;

  const offRamp = item.labels.find((l) => (OFF_RAMP_LABELS as readonly string[]).includes(l));
  if (offRamp) return `off-ramp ${offRamp}`;
  if (item.labels.includes('loopdog:quarantine')) return 'quarantined';
  if (item.labels.includes('loopdog:stop')) return 'kill switch';
  if (item.labels.includes('loopdog:needs-approval') && !item.labels.includes('loopdog:approved')) {
    return 'awaiting approval';
  }
  // `loopdog:parked` holds: budget/quota gates (M12) clear or re-park them via
  // the runner pre-flight; the sweep skips them to avoid blind dispatch.
  if (item.labels.includes('loopdog:parked')) return 'parked (operational hold)';
  return null;
}
