import type { BackendCapabilities } from '@loopdog/core';

/**
 * Drift report (task 0087): when the live smoke fails, classify WHAT drifted so
 * the fix is a reviewed fixture/cassette update, not a mystery. Three kinds:
 *  - capability — the backend's declared `Capabilities` shape/flags changed
 *  - api        — the routine `/fire` or `@codex` invocation contract changed
 *  - correlation— the branch/trailer/issue-ref correlation shape (0073) changed
 */
export type DriftKind = 'capability' | 'api' | 'correlation';

export interface DriftFinding {
  kind: DriftKind;
  field: string;
  expected: unknown;
  observed: unknown;
}

export interface DriftReport {
  drifted: boolean;
  findings: DriftFinding[];
  /** A human summary suitable for a tracking-issue body. */
  summary: string;
}

export interface ObservedShape {
  capabilities?: Partial<BackendCapabilities> | undefined;
  /** The dispatch contract the harness observed (branch/trailer it asked for). */
  correlation?:
    | {
        branchPrefix?: string | undefined;
        trailerKey?: string | undefined;
        linksIssue?: boolean | undefined;
      }
    | undefined;
  /** The provider invocation contract (e.g. routine name / mention token). */
  api?: { triggerMode?: string | undefined } | undefined;
}

export type ExpectedShape = ObservedShape;

/** Compare observed vs the recorded fingerprint and classify the drift. */
export function classifyDrift(expected: ExpectedShape, observed: ObservedShape): DriftReport {
  const findings: DriftFinding[] = [];

  // capability drift — flag-by-flag over the declared capabilities.
  const ec = expected.capabilities ?? {};
  const oc = observed.capabilities ?? {};
  for (const key of new Set([...Object.keys(ec), ...Object.keys(oc)])) {
    const e = (ec as Record<string, unknown>)[key];
    const o = (oc as Record<string, unknown>)[key];
    if (JSON.stringify(e) !== JSON.stringify(o)) {
      findings.push({ kind: 'capability', field: key, expected: e, observed: o });
    }
  }

  // api drift — the trigger contract.
  if (expected.api?.triggerMode !== observed.api?.triggerMode) {
    findings.push({
      kind: 'api',
      field: 'triggerMode',
      expected: expected.api?.triggerMode,
      observed: observed.api?.triggerMode,
    });
  }

  // correlation drift — branch/trailer/issue-ref shape.
  const ecorr = expected.correlation ?? {};
  const ocorr = observed.correlation ?? {};
  for (const key of ['branchPrefix', 'trailerKey', 'linksIssue'] as const) {
    if (ecorr[key] !== ocorr[key]) {
      findings.push({
        kind: 'correlation',
        field: key,
        expected: ecorr[key],
        observed: ocorr[key],
      });
    }
  }

  const drifted = findings.length > 0;
  return { drifted, findings, summary: renderSummary(findings) };
}

function renderSummary(findings: DriftFinding[]): string {
  if (findings.length === 0) return 'No drift: observed shape matches the recorded fingerprint.';
  const byKind = new Map<DriftKind, DriftFinding[]>();
  for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const lines = ['⚠️ Live-smoke drift detected:'];
  for (const [kind, fs] of byKind) {
    lines.push(`\n**${kind} drift** (${fs.length}):`);
    for (const f of fs) {
      lines.push(
        `- \`${f.field}\`: expected ${JSON.stringify(f.expected)}, observed ${JSON.stringify(f.observed)}`,
      );
    }
  }
  lines.push(
    '\nRe-record the affected cassette with `--rerecord` (secret-scrubbed) and review the fixture diff.',
  );
  return lines.join('\n');
}
