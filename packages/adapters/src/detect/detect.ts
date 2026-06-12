import type { ProjectAdapter, RepoFs } from '@looper/core';

/**
 * Stack auto-detection (task 0025): score every registered adapter's detect()
 * evidence, rank deterministically, and fall back to `generic` below the
 * confidence floor. Explicit config always wins over detection. NEVER throws —
 * the generic fallback guarantees a usable result.
 */

export interface DetectionMatch {
  adapter: string;
  confidence: number;
  evidence: string[];
  toolchain?: Record<string, string> | undefined;
}

export const DEFAULT_CONFIDENCE_FLOOR = 0.5;

/** Fixed priority order for exact-confidence ties (determinism, not file order). */
const TIE_ORDER = ['node', 'python', 'generic'];

export async function detectStack(
  repo: RepoFs,
  adapters: readonly ProjectAdapter[],
  opts: { disable?: readonly string[] } = {},
): Promise<DetectionMatch[]> {
  const matches: DetectionMatch[] = [];
  for (const adapter of adapters) {
    if (opts.disable?.includes(adapter.name)) continue;
    const result = await adapter.detect(repo);
    if (!result.matched) continue;
    matches.push({
      adapter: adapter.name,
      confidence: result.confidence,
      evidence: result.evidence,
      toolchain: result.toolchain,
    });
  }
  return matches.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      TIE_ORDER.indexOf(a.adapter) - TIE_ORDER.indexOf(b.adapter) ||
      a.adapter.localeCompare(b.adapter),
  );
}

export interface AdapterChoice {
  adapter: string;
  evidence: string[];
  /** Full detection ranking (advisory, surfaced by init/status). */
  detection: DetectionMatch[];
}

export function chooseAdapter(
  matches: DetectionMatch[],
  config: { adapter?: string | undefined; confidenceFloor?: number | undefined } = {},
): AdapterChoice {
  if (config.adapter && config.adapter !== 'auto') {
    return {
      adapter: config.adapter,
      evidence: ['explicit override in looper.yml'],
      detection: matches,
    };
  }
  const floor = config.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const top = matches[0];
  if (top && top.confidence >= floor) {
    return { adapter: top.adapter, evidence: top.evidence, detection: matches };
  }
  return {
    adapter: 'generic',
    evidence: ['no confident match; using generic command adapter'],
    detection: matches,
  };
}
