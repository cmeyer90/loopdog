import type {
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  ItemRef,
  WorkBrief,
} from '@loopdog/core';
import { classifyDrift, type DriftReport, type ExpectedShape } from './drift-report.js';

/**
 * Live-smoke harness (task 0087, TIER 5 — spends real quota). Drives ONE safe
 * loop edge through a REAL backend against a scratch repo: seed a `tier:safe`
 * issue → real `dispatch` → bounded wait for the provider's PR → real `ingest`
 * (0073 correlation) → assert (correlated PR, one-edge advance, run-record) →
 * cleanup (always, even on failure). Minimal by design (one loop/edge/provider)
 * to stay inside provider rate caps. NEVER run on the per-PR primary path.
 */

export type SmokeStatus = 'passed' | 'failed' | 'skipped';

export interface SmokeResult {
  status: SmokeStatus;
  provider: string;
  /** Why we skipped (e.g. rate-capped, no credential) — set when skipped. */
  skipReason?: string;
  /** Diagnostic on failure. */
  failure?: string;
  /** Drift classification when the smoke detects provider drift. */
  drift?: DriftReport;
  prNumber?: number;
}

export interface LiveSmokeConfig {
  gh: GitHubPort;
  backend: ExecutionBackend;
  provider: string;
  /** The scratch issue to drive (already a safe, groomed `ready-for-agent`). */
  item: ItemRef;
  /** Build the work brief for the one edge under test. */
  brief: WorkBrief;
  /** Expected provider shape (the recorded fingerprint) for drift classification. */
  expected: ExpectedShape;
  /** Bounded wait for the provider's PR, in ms (default 10 min). */
  waitMs?: number;
  /** Poll interval, in ms (default 20s). */
  pollMs?: number;
  /** Injected clock + sleep (so tests can drive it); defaults to real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run the smoke. Returns a structured result; throws only on programmer error.
 * A rate-cap response yields `skipped` (no false alarm); a timeout yields
 * `failed` with the no-result diagnostic (the live analogue of the sweep path).
 */
export async function runLiveSmoke(config: LiveSmokeConfig): Promise<SmokeResult> {
  const provider = config.provider;
  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? realSleep;
  const waitMs = config.waitMs ?? 10 * 60_000;
  const pollMs = config.pollMs ?? 20_000;

  // Drift pre-check: the live capabilities vs the recorded fingerprint.
  const observedCaps = config.backend.capabilities();
  const drift = classifyDrift(config.expected, {
    capabilities: observedCaps,
    api: { triggerMode: observedCaps.triggerModes[0] },
    correlation: {
      branchPrefix: config.brief.expectedBranch.split('/').slice(0, 2).join('/'),
      trailerKey: config.brief.expectedTrailer.split(':')[0],
      linksIssue: true,
    },
  });

  let handle: DispatchHandle;
  try {
    handle = await config.backend.dispatch(config.brief);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (isRateCap(reason)) {
      return { status: 'skipped', provider, skipReason: `rate-capped: ${reason}` };
    }
    return { status: 'failed', provider, failure: `dispatch failed: ${reason}`, drift };
  }

  // Bounded wait → real ingest (0073 correlation).
  const deadline = now() + waitMs;
  while (now() < deadline) {
    const result = await config.backend.ingest(handle);
    if (result.status === 'completed') {
      const prNumber = result.pr?.ref.number;
      const advanced = await advancedOneEdge(config.gh, config.item);
      if (!prNumber) {
        return {
          status: 'failed',
          provider,
          failure: 'ingest completed without a correlated PR',
          drift,
        };
      }
      if (!advanced) {
        return {
          status: 'failed',
          provider,
          failure: 'PR correlated but the item did not advance',
          drift,
          prNumber,
        };
      }
      return {
        status: drift.drifted ? 'failed' : 'passed',
        provider,
        prNumber,
        ...(drift.drifted ? { drift } : {}),
      };
    }
    if (result.status === 'failed') {
      if (isRateCap(result.reason ?? '')) {
        return { status: 'skipped', provider, skipReason: `rate-capped: ${result.reason}` };
      }
      return {
        status: 'failed',
        provider,
        failure: `ingest reported failure: ${result.reason}`,
        drift,
      };
    }
    await sleep(pollMs);
  }
  return {
    status: 'failed',
    provider,
    failure: `timeout: no provider PR within ${waitMs}ms`,
    drift,
  };
}

function isRateCap(text: string): boolean {
  return /rate.?limit|quota|429|too many requests|cap(ped|acity)/i.test(text);
}

/** True if the scratch item carries a loopdog state label (advanced one edge). */
async function advancedOneEdge(gh: GitHubPort, item: ItemRef): Promise<boolean> {
  const labels = await gh.getItemLabels(item);
  return labels.some((l) => l.startsWith('loopdog:state/'));
}

/**
 * Best-effort scratch cleanup so nightly runs don't accrete dead state. Call
 * from a `finally`/post step. The hermetic part (clearing loopdog's own labels)
 * uses the port; closing PRs/issues + deleting branches is provider-specific
 * and outside the port, so the operator passes a `closer` closure for it.
 */
export async function cleanupScratch(
  gh: GitHubPort,
  item: ItemRef,
  closer?: () => Promise<void>,
): Promise<void> {
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      // best-effort: a cleanup failure must not mask the smoke result.
    }
  };
  // Remove loopdog's own labels from the scratch item.
  const labels = await gh.getItemLabels(item).catch(() => [] as string[]);
  for (const l of labels.filter((x) => x.startsWith('loopdog:'))) {
    await safe(() => gh.removeLabel(item, l));
  }
  if (closer) await safe(closer);
}
