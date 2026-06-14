import type { EffectPolicy, Mode, PlannedAction } from '@loopdog/core';
import { allowedEffects } from '@loopdog/core';

/**
 * The single effect boundary (task 0009): every outward effect in the
 * transition pipeline flows through this gate. In `act` the effect runs; in
 * `dry-run`/`suggest` it is recorded as a `PlannedAction` instead — so the run
 * record always carries what loopdog did or would have done.
 */
export class EffectGate {
  readonly mode: Mode;
  readonly policy: EffectPolicy;
  readonly planned: PlannedAction[] = [];

  constructor(mode: Mode) {
    this.mode = mode;
    this.policy = allowedEffects(mode);
  }

  /** Label/PR/plan/claim mutations. Returns null when blocked. */
  async mutate<T>(
    kind: PlannedAction['kind'],
    detail: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    this.planned.push({ kind, detail });
    if (!this.policy.mutateRepo) return null;
    return fn();
  }

  /** Comments (allowed in suggest; blocked in dry-run). Returns null when blocked. */
  async comment<T>(detail: string, fn: () => Promise<T>): Promise<T | null> {
    this.planned.push({ kind: 'comment', detail });
    if (!this.policy.comment) return null;
    return fn();
  }

  /** Backend dispatch. Returns null when blocked. */
  async dispatch<T>(detail: string, fn: () => Promise<T>): Promise<T | null> {
    this.planned.push({ kind: 'dispatch', detail });
    if (!this.policy.dispatch) return null;
    return fn();
  }

  /** Record a read/compose step that happens in every mode. */
  note(kind: PlannedAction['kind'], detail: string): void {
    this.planned.push({ kind, detail });
  }
}
