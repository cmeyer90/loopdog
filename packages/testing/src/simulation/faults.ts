import type { Action } from './sim.js';

/**
 * Fault injectors (task 0086), expressed as schedule builders the engine
 * runs against the real controller. Each reproduces one concurrency/delivery
 * hazard; the matching invariant (invariants.ts) must hold afterward.
 */

/** Event storm: M near-simultaneous identical events for one item (one engine
 * step). The claim (0013) + idempotency key (0012) must collapse to ≤1 dispatch. */
export function eventStorm(name: string, payload: Record<string, unknown>, m = 3): Action {
  return {
    kind: 'concurrent',
    label: `storm×${m} ${name}`,
    actions: Array.from({ length: m }, () => ({ kind: 'event', name, payload }) as Action),
  };
}

/** Event ↔ sweep race: an item's event and a sweep tick in the SAME step —
 * both must not advance the item twice (TOCTOU on selection vs. claim). */
export function raceEventSweep(name: string, payload: Record<string, unknown>): Action {
  return {
    kind: 'concurrent',
    label: `race ${name}↔sweep`,
    actions: [{ kind: 'event', name, payload }, { kind: 'sweep' }],
  };
}

/** Duplicated webhook: the same event delivered N times (at-least-once
 * delivery). Ingest (0073) must be idempotent — exactly one effect. */
export function duplicateWebhook(name: string, payload: Record<string, unknown>, n = 2): Action[] {
  return Array.from({ length: n }, () => ({ kind: 'event', name, payload }) as Action);
}

/**
 * Dropped webhook: the triggering event is silently lost (GitHub missed
 * delivery), so recovery must come ONLY from the sweep (0076). Model it by
 * NOT enqueueing the event and instead advancing the clock + sweeping; the
 * item must not be stranded.
 */
export function sweepRecovery(advanceMs = 60_000): Action[] {
  return [
    { kind: 'advance', ms: advanceMs },
    { kind: 'sweep', label: 'recover-via-sweep' },
  ];
}

/**
 * Crash mid-run: abort an invocation after its K-th op of `op` kind (a
 * claim/compose/dispatch/ingest/write boundary), leaving partial state. A
 * later event/sweep must recover with no double-dispatch and no orphaned
 * claim past its lease.
 */
export function crashMidRun(op: string, count: number, then: Action): Action {
  return { kind: 'crashAfter', op, count, then };
}
