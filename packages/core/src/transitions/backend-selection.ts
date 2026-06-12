/**
 * Backend selection (task 0023) — pure precedence logic, in core so the
 * config resolver can apply it without crossing package boundaries:
 *   loop per-stage → loop default → root per-stage → root default → 'claude'.
 */
export type Stage = 'implement' | 'review';

/** Review-stage derivation rule: edges leaving `in-review` are reviews. */
export function deriveStage(transition: { from: string; to: string }): Stage {
  return transition.from === 'in-review' ? 'review' : 'implement';
}

export function selectBackend(
  root: { default?: string | undefined; review?: string | undefined },
  loop: {
    backend?: string | undefined;
    reviewBackend?: string | undefined;
    transition: { from: string; to: string };
  },
  stage: Stage = deriveStage(loop.transition),
): string {
  if (stage === 'review' && loop.reviewBackend) return loop.reviewBackend;
  if (loop.backend) return loop.backend;
  if (stage === 'review' && root.review) return root.review;
  return root.default ?? 'claude';
}
