import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the instant-handoff wiring (task 0105): the optional LOOPDOG_PAT must
// flow from the scaffolded callers into the reusable workflows' controller env,
// or controller→controller handoffs silently fall back to the throttled sweep.
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('LOOPDOG_PAT instant-handoff wiring (task 0105)', () => {
  for (const wf of ['reusable-events.yml', 'reusable-sweep.yml']) {
    it(`${wf} accepts loopdog_pat and exports it as LOOPDOG_PAT`, () => {
      const text = read(`.github/workflows/${wf}`);
      expect(text, 'declares the optional secret').toContain('loopdog_pat:');
      expect(text, 'exports it to the controller env').toContain(
        'LOOPDOG_PAT: ${{ secrets.loopdog_pat }}',
      );
    });
  }

  for (const wf of ['loopdog-events.yml', 'loopdog-sweep.yml']) {
    it(`scaffolded ${wf} forwards the LOOPDOG_PAT secret`, () => {
      expect(read(`templates/workflows/${wf}`)).toContain(
        'loopdog_pat: ${{ secrets.LOOPDOG_PAT }}',
      );
    });
  }
});
