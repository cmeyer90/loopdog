import type { ControllerOptions } from '@looper/runtime';
import type { FakeGitHub } from '../fake-github/fake-github.js';
import { VirtualClock } from './clock.js';
import { Sim, SimViolation, type Action } from './sim.js';
import type { Invariant } from './invariants.js';

/**
 * Seeded property/fuzz mode (task 0086). Generates randomized schedules from a
 * base action set across N seeds; on the first invariant violation it shrinks
 * to the minimal failing prefix and returns `{ seed, trace, violatedInvariant }`
 * for a deterministic repro (re-run by seed). A small fixed seed set is fast
 * enough for per-PR CI; the wide sweep runs nightly (0087).
 */

export interface FuzzWorld {
  opts: ControllerOptions;
  gh: FakeGitHub;
}

export interface FuzzConfig {
  /** Number of seeds to try (0..seeds-1, deterministic). */
  seeds: number;
  /** Build a FRESH world per run (new gh/backend/records over the same config). */
  makeWorld: () => FuzzWorld | Promise<FuzzWorld>;
  /** Base schedule; the fuzzer permutes order and injects duplicates. */
  actions: Action[];
  invariants?: Invariant[];
  /** Clock start (default the fakes' base instant). */
  clockStart?: string;
  /** Quiescence ticks after the schedule (default 6). */
  quiesceTicks?: number;
}

export interface FuzzViolation {
  seed: number;
  invariant: string;
  detail: string;
  trace: string[];
  /** The minimal failing schedule (post-shrink), as descriptors. */
  schedule: string[];
}

export interface FuzzResult {
  ran: number;
  violation?: FuzzViolation;
}

/** mulberry32 — tiny, fast, fully deterministic PRNG seeded by an integer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Permute a base schedule: shuffle order + randomly duplicate some events. */
function permute(actions: Action[], rng: () => number): Action[] {
  const shuffled = shuffle(actions, rng);
  const out: Action[] = [];
  for (const a of shuffled) {
    out.push(a);
    // 25% chance to duplicate an event (models at-least-once redelivery).
    if (a.kind === 'event' && rng() < 0.25) out.push(a);
  }
  return out;
}

async function runSchedule(config: FuzzConfig, schedule: Action[]): Promise<SimViolation | null> {
  const world = await config.makeWorld();
  const clock = new VirtualClock(config.clockStart);
  const sim = new Sim({
    opts: world.opts,
    gh: world.gh,
    clock,
    ...(config.invariants ? { invariants: config.invariants } : {}),
    failFast: true,
  });
  try {
    await sim.run(schedule);
    await sim.runToQuiescence(config.quiesceTicks ?? 6);
    return null;
  } catch (e) {
    if (e instanceof SimViolation) return e;
    throw e; // a real bug in the harness/runtime, not an invariant violation
  }
}

/** Shrink to the shortest failing prefix that still reproduces a violation. */
async function shrink(config: FuzzConfig, schedule: Action[]): Promise<Action[]> {
  for (let len = 1; len <= schedule.length; len++) {
    const prefix = schedule.slice(0, len);
    if (await runSchedule(config, prefix)) return prefix;
  }
  return schedule;
}

export async function fuzz(config: FuzzConfig): Promise<FuzzResult> {
  for (let seed = 0; seed < config.seeds; seed++) {
    const rng = mulberry32(seed + 1);
    const schedule = permute(config.actions, rng);
    const violation = await runSchedule(config, schedule);
    if (violation) {
      const minimal = await shrink(config, schedule);
      const reproduced = (await runSchedule(config, minimal)) ?? violation;
      const v = reproduced.violations[0]!;
      return {
        ran: seed + 1,
        violation: {
          seed,
          invariant: v.invariant,
          detail: v.detail,
          trace: reproduced.trace,
          schedule: minimal.map((a) => a.kind),
        },
      };
    }
  }
  return { ran: config.seeds };
}
