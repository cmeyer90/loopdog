# 0045 Graduated Auto-Merge Policy

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Decide, for a `mergeable` PR, **whether loopdog merges it autonomously or holds for
a human** — gated by the item's risk tier. Human-gated by default; `tier:safe` may
auto-merge once its loop is promoted; `tier:core` is *always* human-gated via the
adopter's CODEOWNERS. This task also **defines tier assignment itself** (today only
consumed, never derived) so the gating label is loopdog-trusted, not stranger-set.

## Background

Part of [Milestone 10](../milestones/milestone-10-review-verification-ladder-and-merge-loop.md)
("Graduated autonomy: `tier:safe` may auto-merge once trusted; `tier:core` stays
human-gated via CODEOWNERS"). It consumes the ladder's `mergeable`/`blockedBy`
result (0041) and is the final transition `in-review`/`verified -> merged`. See
[architecture](../../docs/architecture.md) "The verification ladder (trust)" —
*"Merge authority is gated on rungs 2–4 … human-gated by default; promote
`tier:safe` to auto-merge as it earns trust; keep `tier:core` human-gated via
CODEOWNERS forever."* Tier source is the `risk_tiers` config in 0006; auth/label
trust ties to [M17](../milestones/milestone-17-authorization-and-trigger-control.md).

## Scope

- **Tier assignment** (new, load-bearing): derive an item's *effective* tier from
  path-glob match against `risk_tiers` + the loop's `gates.tier` ceiling, write it
  as a loopdog-trusted `loopdog:tier/<tier>` label, and re-derive it on the sweep.
- **The auto-merge policy engine** in `@loopdog/core`: given the tier, the loop mode,
  and the ladder result, decide `auto_merge | hold_for_human | blocked`.
- The merge action in `@loopdog/github` (squash-merge via `GITHUB_TOKEN`) + the
  `verified -> merged` transition write-back, executed only on an `auto_merge`
  decision.
- A label-trust check so a stranger-applied `loopdog:tier/safe` cannot widen autonomy.

### Technical detail

**Package landing:** policy + tier derivation are pure domain →
`@loopdog/core` (`core/src/merge/policy.ts`, `core/src/merge/tier.ts`, exported from
`core/index.ts`). Label IO + merge API + the loopdog-applied-label audit read →
`@loopdog/github` (`github/src/merge/`, reusing `github/src/labels/`). The
`risk_tiers` / `gates.tier` schema already lives in `@loopdog/config` (0006); this
task only *reads* it. The merge loop is a built-in loop asset shipped by
`@loopdog/runtime` (`templates/loops/merge/`).

**1. Tier assignment — `deriveTier(changedPaths, loopGatesTier, config.risk_tiers)`:**

```ts
type Tier = 'safe' | 'core';            // ordered: core stricter than safe
interface TierDecision { tier: Tier; reason: string; matchedGlobs: string[]; }
```

- `risk_tiers` (0006) maps each tier to globs, e.g.
  `safe: ["docs/**","**/*.test.*"]`, `core: ["src/auth/**","migrations/**"]`.
- Match the PR's **changed file paths** (from the PR diff) against each tier's
  globs. **Strictest wins**: if *any* changed path matches a `core` glob → `core`.
  Else if every changed path matches a `safe` glob → `safe`. **Unmatched paths
  default to `core`** (fail closed — an unclassified file is treated as high-risk).
- The loop's `gates.tier` (0006) is a **ceiling, not an override**: `min(globTier,
  ceiling)` by strictness — a loop pinned `gates.tier: core` is always `core` even
  if its paths look safe; a loop pinned `safe` is *raised* to `core` if its paths
  match a core glob. Strictest of {glob result, ceiling} wins.
- Result is written as a single trusted label `loopdog:tier/<tier>` (namespace per
  0011), replacing any prior `loopdog:tier/*`. Re-derived on every PR
  `synchronize` event and on the sweep (paths change as the PR evolves).

**2. Label trust (SECURITY — ties to M17):** the `loopdog:tier/*` label gates
autonomy, so a stranger who can edit issues/labels must not be able to relabel a
`core` PR as `safe`. Two defenses, fail-closed:

- The policy engine **never trusts the label as input**; it always recomputes
  `deriveTier` from the live PR diff at decision time and uses the *recomputed*
  tier for the merge decision. The label is a *cache/UX surface*, not the source of
  truth.
- On each decision, reconcile: if the on-issue `loopdog:tier/*` label disagrees with
  the recomputed tier, overwrite it to the loopdog-derived value and record an audit
  comment. A `loopdog:tier/safe` that loopdog did not apply (provenance checked via
  the labeling actor — loopdog writes labels as `GITHUB_TOKEN`/`github-actions[bot]`)
  is corrected, not honored. This is the access-control sibling of the M17
  authorization gate: untrusted state never widens autonomy.

**3. Policy engine — `decideMerge(tier, mode, ladder, codeowners)`:**

```ts
type MergeDecision =
  | { action: 'auto_merge'; tier: Tier }
  | { action: 'hold_for_human'; reason: string }   // post comment, leave label `in-review`/`verified`
  | { action: 'blocked'; blockedBy: RungId[] };     // ladder not green yet
```

Decision table (evaluate top-down, first match wins):

| Condition                                             | Decision         |
|-------------------------------------------------------|------------------|
| `ladder.mergeable === false`                          | `blocked`        |
| `tier === 'core'`                                     | `hold_for_human` |
| `mode !== 'act'` (loop not promoted)                  | `hold_for_human` |
| PR touches a CODEOWNERS-owned path                    | `hold_for_human` |
| `tier === 'safe'` and all above clear                 | `auto_merge`     |

- `tier:core` is **never** auto-mergeable regardless of mode — enforced here *and*
  structurally by the adopter's CODEOWNERS + branch protection (0004), so a policy
  bug cannot bypass an owner. This is defense in depth, not redundancy.
- `auto_merge` calls the merge action (squash via the merge API over
  `GITHUB_TOKEN`), sets `loopdog:state/merged`, and records the decision in the run
  record (0012). The merge commit carries a `loopdog-merge: <run_id>` trailer for
  audit/correlation.
- `hold_for_human` posts a single rung-by-rung status comment (reusing the
  `LadderResult` renderer from 0041) explaining *why* it is held (tier/mode/owner)
  and leaves the item for a human; it does **not** keep re-commenting (idempotent —
  guard on an existing marker comment).

**4. CODEOWNERS check:** loopdog reads `.github/CODEOWNERS` (the adopter's) and
matches changed paths; any match → `hold_for_human` even for `tier:safe`. Loopdog
does not enforce CODEOWNERS (GitHub branch protection does, 0004); this check just
avoids dispatching a merge GitHub will reject and surfaces the reason early.

**Edge cases (fail closed):** empty/unreadable `risk_tiers` → everything `core`
(no auto-merge); PR with zero changed files → `core`; ladder `pending` → `blocked`,
re-evaluate on the next event/sweep against the current head SHA; a PR whose tier
flips `safe -> core` mid-flight (a new core path added) → next decision holds for a
human and corrects the label.

## Out Of Scope

- The ladder model + `mergeable`/`blockedBy` computation (0041) — consumed here.
- Cross-model review (0042), intent-diff (0043), and the fix sub-loop (0044).
- `loopdog promote --to act` mechanics + the `tier:core`-merge promote guard (0009);
  this task reads `mode`, it does not set it.
- Deploy smoke / rollback (M11 · 0047/0048) — a separate rung/loop.
- Branch protection + CODEOWNERS *enforcement* (0004) — the adopter's, not loopdog's.

## Acceptance Criteria

- [x] `deriveTier` returns `core` if any changed path matches a `core` glob, `safe`
      only if every path matches `safe`, and `core` for any unmatched path.
- [x] `gates.tier` acts as a strictness ceiling; the strictest of {glob, ceiling}
      wins, proven by a loop pinned `core` over `safe`-looking paths.
- [x] The effective tier is written as a single trusted `loopdog:tier/<tier>` label,
      re-derived on `synchronize` and on the sweep.
- [x] A stranger-applied `loopdog:tier/safe` on a `core` PR is **corrected**, not
      honored; the merge decision uses the recomputed tier, never the raw label.
- [x] `tier:core` is never auto-merged regardless of loop mode (held for human).
- [x] `tier:safe` + `mode: act` + `ladder.mergeable` + no CODEOWNERS path →
      `auto_merge`; the PR is squash-merged and labeled `loopdog:state/merged`.
- [x] A non-green ladder yields `blocked` (no merge), re-evaluated on the next event.
- [x] `hold_for_human` posts exactly one explanatory comment (idempotent).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Implement `deriveTier` + `TierDecision` in `core/src/merge/tier.ts`
      (strictest-wins, ceiling, unmatched→core); export from `core/index.ts`.
- [x] Implement `decideMerge` policy engine in `core/src/merge/policy.ts` per the
      decision table.
- [x] Add tier-label write/reconcile + provenance check in `github/src/merge/`
      (reuse `github/src/labels/`).
- [x] Add the squash-merge action + `verified -> merged` write-back + `loopdog-merge`
      trailer in `@loopdog/github`.
- [x] Add the CODEOWNERS-path match helper (read adopter `.github/CODEOWNERS`).
- [x] Ship the built-in merge loop asset (`templates/loops/merge/`) in
      `@loopdog/runtime`, wiring the policy into the transition (0012).
- [x] Record the merge decision in the run record (0012) for telemetry (M12).

## Test Plan

Tests run via the repo's vitest runner; behavioral tests use the M18 fakes
(in-memory GitHub from `@loopdog/testing`) — no real provider quota.

```bash
# replace with the repo's vitest invocation
# core glob match → tier:core; all-safe paths → tier:safe; unmatched path → core
# gates.tier:core ceiling over safe-looking paths → core
# stranger-set loopdog:tier/safe on a core PR → recomputed core, label corrected, held
# tier:safe + act + mergeable + no codeowner path → auto_merge + state/merged
# tier:core + mergeable + act → hold_for_human (never auto-merges)
# ladder not mergeable → blocked, no merge call; re-eval next event
# hold_for_human invoked twice → single comment (idempotent)
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

- Policy = three layers: (1) the promote guard — a tier:core merge loop can
  NEVER be promoted to act (the dial a loop must not turn itself); (2) the
  runtime DoD gate (decideMerge): required checks green + standing approval +
  every criterion attested, else blocked (with reasons commented) or waiting;
  (3) the merge API call is squash with refusal handling.
- Merged state mirrors to the bound issue; the closed PR keeps its terminal
  label and drops out of sweeps (deploy states ride the open issue).

## Risks / Rollback

The central risk is **autonomy widening from untrusted state**: a spoofed
`loopdog:tier/safe` auto-merging a `core` change. Mitigation — the decision always
recomputes the tier from the live diff (label is never trusted as input),
unmatched paths fail to `core`, and `tier:core` is barred from auto-merge here *and*
by the adopter's CODEOWNERS/branch protection (0004). A secondary risk is a wrong
auto-merge of safe work; the loop is `dry-run` by default and only auto-merges
after explicit promotion (0009). Rollback: this task is additive behind the 0041
ladder gate — reverting it leaves every PR `hold_for_human` (the safe default), so
no PR is stranded, only un-auto-merged.

## Final Summary

Graduated auto-merge: human-gated by default (dry-run + tier:core promote
guard), DoD-gated at runtime, squash-merged with issue mirroring when every
rung passes — proven in the e2e merge step with checks + approval seeded.
