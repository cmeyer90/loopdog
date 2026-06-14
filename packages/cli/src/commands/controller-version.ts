/**
 * Read + assess the controller version an attached repo pins (task 0101).
 *
 * The controller runs whatever `@loopdog/cli` version the caller workflows pin
 * via `loopdog-version`. A floating pin (`'N'`, with `uses: …@vN`) auto-tracks
 * every release; an exact pin (`0.2.0`) does not — so updating the local CLI
 * leaves the deployed controller behind, silently missing fixes. `loopdog status`
 * uses this to nudge `loopdog upgrade` (task 0100) when that happens.
 */

export type ControllerDriftStatus = 'floating' | 'current' | 'behind' | 'ahead' | 'none';

export interface ControllerDrift {
  status: ControllerDriftStatus;
  /** What the repo pins, verbatim (e.g. `0.2.0` exact or `0` floating); null when none do. */
  pinned: string | null;
  /** The installed CLI version. */
  cli: string;
}

/** Pull the `loopdog-version` input out of one caller workflow, or null if absent. */
export function readPinnedVersion(content: string): string | null {
  const m = content.match(/^\s*loopdog-version:\s*['"]?([^'"#\s]+)['"]?/m);
  return m ? m[1]! : null;
}

/** A bare major like `0` means "track the latest N.x" — it floats; `0.2.0` is exact. */
function isFloating(pin: string): boolean {
  return /^\d+$/.test(pin);
}

/** Numeric semver-ish compare: -1 if a<b, 0 if equal, 1 if a>b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Assess controller-pin drift across all caller workflows vs the installed CLI.
 * Reports the worst case — a single exact pin older than the CLI is `behind`
 * (the actionable one) and short-circuits. A floating pin can't drift.
 */
export function assessControllerDrift(
  callerContents: readonly string[],
  cliVersion: string,
): ControllerDrift {
  const pins = callerContents.map(readPinnedVersion).filter((p): p is string => p !== null);
  if (pins.length === 0) return { status: 'none', pinned: null, cli: cliVersion };

  let result: ControllerDrift = {
    status: 'floating',
    pinned: pins.find(isFloating) ?? pins[0]!,
    cli: cliVersion,
  };
  for (const pin of pins) {
    if (isFloating(pin)) continue; // floats — auto-tracks, never stale
    const cmp = compareVersions(pin, cliVersion);
    if (cmp < 0) return { status: 'behind', pinned: pin, cli: cliVersion }; // actionable
    result = { status: cmp > 0 ? 'ahead' : 'current', pinned: pin, cli: cliVersion };
  }
  return result;
}
