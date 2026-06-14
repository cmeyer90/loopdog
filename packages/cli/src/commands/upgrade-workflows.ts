/**
 * Re-sync a scaffolded caller workflow's loopdog version pins (task 0100).
 *
 * loopdog is zero-infra — it can't push updates into an adopter repo — so a
 * caller workflow only stays current if it FLOATS on the major tag the release
 * pipeline keeps moving (`uses: …@vN`, `loopdog-version: 'N'`). Repos scaffolded
 * by an older loopdog got EXACT pins (`@<sha>`, `0.2.0`) that never move, so they
 * silently run a stale controller. `loopdog upgrade` calls this to convert those
 * back to the floating default — one upgrade and they auto-track from then on.
 */

export interface CallerPinChange {
  field: 'uses' | 'loopdog-version';
  from: string;
  to: string;
}

const USES_LINE =
  /^(\s*uses:\s*)(\S+\/loopdog\/\.github\/workflows\/reusable-[\w-]+\.yml)@([^\s#]+)(.*)$/m;
const VERSION_LINE = /^(\s*loopdog-version:\s*)(['"]?)([^'"#\s]+)\2(.*)$/m;

/**
 * Rewrite a loopdog caller workflow's reusable-workflow ref and `loopdog-version`
 * input to the floating major `vN` / `'N'`. Touches ONLY those two lines; the
 * rest of the file (owner/repo, secrets, trailing comments) is byte-identical.
 * Returns the new content plus the changes — `changes` empty means it wasn't a
 * loopdog caller (e.g. the custom deploy workflow) or was already floating.
 */
export function retargetCallerWorkflow(
  content: string,
  major: number,
): { content: string; changes: CallerPinChange[] } {
  const changes: CallerPinChange[] = [];
  let next = content;

  next = next.replace(USES_LINE, (whole, pre: string, path: string, ref: string, rest: string) => {
    const want = `v${major}`;
    if (ref === want) return whole;
    changes.push({ field: 'uses', from: shortRef(ref), to: want });
    return `${pre}${path}@${want}${rest}`;
  });

  next = next.replace(VERSION_LINE, (whole, pre: string, _q: string, val: string, rest: string) => {
    const want = String(major);
    if (val === want) return whole;
    changes.push({ field: 'loopdog-version', from: val, to: want });
    return `${pre}'${want}'${rest}`;
  });

  return { content: next, changes };
}

/** A 40-hex commit SHA is unreadable in a report — show the first 7 like git does. */
function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}
