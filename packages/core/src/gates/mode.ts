/**
 * Execution modes + the effect policy (task 0009): three levels of autonomy,
 * enforced at the runtime's single effect boundary. Dry-run is the default —
 * "safe by default, autonomous by promotion".
 *
 * | mode    | reads | composes | comments          | mutates repo | dispatches |
 * |---------|-------|----------|-------------------|--------------|------------|
 * | dry-run | yes   | preview  | no                | no           | no         |
 * | suggest | yes   | yes      | one advisory      | no           | no         |
 * | act     | yes   | yes      | yes               | yes          | yes        |
 */

export type Mode = 'dry-run' | 'suggest' | 'act';

export const DEFAULT_MODE: Mode = 'dry-run';

export interface EffectPolicy {
  dispatch: boolean;
  mutateRepo: boolean;
  comment: boolean;
}

export function allowedEffects(mode: Mode): EffectPolicy {
  switch (mode) {
    case 'dry-run':
      return { dispatch: false, mutateRepo: false, comment: false };
    case 'suggest':
      return { dispatch: false, mutateRepo: false, comment: true };
    case 'act':
      return { dispatch: true, mutateRepo: true, comment: true };
  }
}

/** A would-be (or actual) effect, recorded on every run (0009/0012). */
export interface PlannedAction {
  kind: 'claim' | 'compose' | 'dispatch' | 'label' | 'comment' | 'plan';
  detail: string;
}
