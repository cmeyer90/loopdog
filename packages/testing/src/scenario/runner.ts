import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ControllerOptions } from '@loopdog/runtime';
import { handleEvent, handleSweep } from '@loopdog/runtime';
import type { IssueSnapshot, PullRequestSnapshot, RunRecord } from '@loopdog/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';
import type { InMemoryRunRecordStore } from '../fake-backends/in-memory-records.js';
import type { VirtualClock } from '../simulation/clock.js';
import { diffGolden, goldenJson, snapshotGolden, type Golden } from './snapshot.js';

/**
 * Declarative scenario runner (task 0085): drives the REAL controller over the
 * fakes through a scripted sequence of events/sweeps/ticks, then snapshots the
 * end-state to a golden. The controller is unmodified; only the leaves (GitHub,
 * backends, clock) are fakes. Quiescence per step is the single controller call
 * — the GITHUB_TOKEN-no-retrigger rule means controller-written transitions
 * only advance on the next explicit `sweep`, exactly as production behaves.
 */

export interface ScenarioStep {
  event?: { name: string; payload: Record<string, unknown> };
  sweep?: Record<string, never>;
  tick?: { ms: number };
}

export interface Scenario {
  name: string;
  seed?: number;
  initial?: {
    issues?: Array<
      Partial<IssueSnapshot> & { ref: { owner?: string; repo?: string; number: number } }
    >;
    pulls?: Array<
      Partial<PullRequestSnapshot> & {
        ref: { owner?: string; repo?: string; number: number };
        headRef: string;
      }
    >;
    branches?: string[];
  };
  steps: ScenarioStep[];
}

export interface ScenarioWorld {
  opts: ControllerOptions;
  gh: FakeGitHub;
  records: InMemoryRunRecordStore;
  clock: VirtualClock;
}

export interface ScenarioResult {
  golden: Golden;
  runs: RunRecord[];
  steps: number;
}

const MAX_ITERATIONS = 1; // one controller call per step (no self-retrigger)

/** Apply the scenario's initial state to the world's fake GitHub. */
async function seed(world: ScenarioWorld, scenario: Scenario): Promise<void> {
  const { owner, repo } = world.opts.repo;
  await world.gh.ensureBranch(world.opts.repo, world.gh.defaultBranch);
  for (const b of scenario.initial?.branches ?? []) await world.gh.ensureBranch(world.opts.repo, b);
  for (const i of scenario.initial?.issues ?? []) {
    world.gh.seedIssue({
      ...i,
      ref: { owner: i.ref.owner ?? owner, repo: i.ref.repo ?? repo, number: i.ref.number },
    });
  }
  for (const p of scenario.initial?.pulls ?? []) {
    world.gh.seedPull({
      ...p,
      ref: { owner: p.ref.owner ?? owner, repo: p.ref.repo ?? repo, number: p.ref.number },
    });
  }
}

export async function runScenario(
  world: ScenarioWorld,
  scenario: Scenario,
): Promise<ScenarioResult> {
  world.gh.clock = world.clock.now;
  world.opts = { ...world.opts, now: world.clock.now };
  await seed(world, scenario);

  let stepCount = 0;
  for (const step of scenario.steps) {
    stepCount++;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (step.tick) {
        world.clock.advance(step.tick.ms);
      } else if (step.event) {
        await handleEvent(world.opts, step.event.name, step.event.payload);
      } else if (step.sweep) {
        await handleSweep(world.opts);
      } else {
        throw new Error(`scenario ${scenario.name}: empty step #${stepCount}`);
      }
    }
  }

  return {
    golden: snapshotGolden(world.gh, world.records, world.opts.repo),
    runs: [...world.records.records],
    steps: stepCount,
  };
}

/** Parse a `*.scenario.yml` / `.json` file into a Scenario (declarative only). */
export async function loadScenario(path: string): Promise<Scenario> {
  const text = await readFile(path, 'utf8');
  const data = path.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) {
    throw new Error(`invalid scenario at ${path}: missing steps[]`);
  }
  return data as Scenario;
}

export interface GoldenOpts {
  /** Directory holding `<name>.golden.json`. */
  dir: string;
  /** Rewrite the golden from the observed end-state (env LOOPDOG_UPDATE_GOLDENS=1). */
  update?: boolean;
}

/**
 * Compare the result against the stored golden (or rewrite it in update mode).
 * A missing golden in compare mode is a failure, not an auto-create, so new
 * scenarios are reviewed. Throws with a readable field-level diff on drift.
 */
export async function assertGolden(
  result: ScenarioResult,
  name: string,
  opts: GoldenOpts,
): Promise<void> {
  const path = join(opts.dir, `${name}.golden.json`);
  const update = opts.update ?? process.env['LOOPDOG_UPDATE_GOLDENS'] === '1';
  if (update) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, goldenJson(result.golden));
    return;
  }
  let stored: string;
  try {
    stored = await readFile(path, 'utf8');
  } catch {
    throw new Error(
      `golden '${name}' is missing (${path}). Re-run with LOOPDOG_UPDATE_GOLDENS=1 to create it (then review).`,
    );
  }
  const golden = JSON.parse(stored) as Golden;
  const { match, diff } = diffGolden(result.golden, golden);
  if (!match) {
    throw new Error(
      `golden '${name}' drifted:\n${diff}\n\nIf intended, re-run with LOOPDOG_UPDATE_GOLDENS=1 and review the diff.`,
    );
  }
}
