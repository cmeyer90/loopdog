# 0054 Cross-Provider Review Policy

Status: planned  
Branch: task/0054-cross-provider-review-policy

## Goal

Make the cross-model reviewer *policy* explicit and configurable: an adopter
declares **which provider reviews which implementer, per risk tier**, and the
review loop's `cross-model` resolver consults that policy instead of the hardcoded
"first distinct `can_review` provider" heuristic — while still guaranteeing
reviewer ≠ implementer and never self-review.

## Background

Part of [Milestone 13](../milestones/milestone-13-multi-model-orchestration.md)
(Multi-Model Orchestration) — the milestone's first deliverable: "Config for which
provider reviews which implementer, per tier." Cross-model review is the default
high-ROI use, wired in M10 by the review cell (0042), which today resolves the
`cross-model` sentinel with a fixed order (run-record implementer → `review.backend`
→ first distinct `can_review` provider). This task turns that single global knob
into a **per-tier policy table** so an adopter can, e.g., always have Claude review
Codex PRs on `tier:core` but allow either reviewer on `tier:safe`. It stays
vendor-neutral (Guiding Decision: "adding a provider needs no engine changes") and
reuses the existing `Backend.capabilities.can_review` flag (M05 · 0019). See
[architecture](../../docs/architecture.md) "The verification ladder (trust)" (rung
3, cross-provider adversarial review) and [codebase](../../docs/codebase.md)
`runtime/loops-builtin` + `config`.

## Scope

- A `review` policy block in root `looper.yml` (schema + validation in `@looper/config`)
  declaring reviewer selection **per risk tier**, layered over per-loop overrides.
- A pure `selectReviewer(policy, implementer, tier, registry)` resolver in
  `@looper/core` that the `cross-model` sentinel (0042) calls instead of its inline
  heuristic.
- Guarantees: reviewer provider ≠ implementer provider; chosen reviewer's
  `capabilities.can_review` is true; deterministic given the same inputs.
- Escalation when the policy yields no eligible distinct reviewer (never self-review,
  never silently fall back across the policy's intent).

### Technical detail

**Package(s):** schema in `@looper/config` (`config/src/schema`), the resolver in
`@looper/core` (new `core/src/transitions/review-policy.ts`, exported from
`index.ts`), consumed by `@looper/runtime`'s `cross-model` selection helper (0042).
No new package; no backend code changes (it reads the existing `can_review`
capability).

**Config shape** (root `looper.yml`; `tier` keys are the M03 risk tiers
`safe`/`core`, with a `default` fallback):

```yaml
review:
  # global default reviewer (kept from 0042) when no per-tier rule matches
  backend: cross-model            # sentinel; or a concrete provider id
  policy:
    safe:
      # any distinct can_review provider is fine on low-risk work
      reviewer: any-distinct
    core:
      # high-risk: pin reviewer per implementer (defense via model diversity)
      pairings:
        claude: codex             # Claude-implemented core PRs → Codex review
        codex:  claude            # Codex-implemented core PRs  → Claude review
        self-hosted: claude
      on_no_pairing: escalate     # escalate | any-distinct (default escalate)
    default:
      reviewer: any-distinct
```

A loop may override per-loop in its `loop.yml` `gates.review` (strictest wins:
a pinned pairing in `looper.yml` `policy.<tier>` is not loosened by a loop).

**Types (in `@looper/core`):**

```ts
type ProviderId = string;                 // 'claude' | 'codex' | 'self-hosted' | ...
type ReviewerRule =
  | { kind: 'any-distinct' }
  | { kind: 'pairings'; pairings: Record<ProviderId, ProviderId>;
      onNoPairing: 'escalate' | 'any-distinct' };
interface ReviewPolicy { byTier: Record<string, ReviewerRule>; default: ReviewerRule; }

type ReviewerChoice =
  | { decision: 'reviewer'; provider: ProviderId; reason: string }
  | { decision: 'escalate'; reason: string };   // → needs-human (0042 path)

function selectReviewer(
  policy: ReviewPolicy,
  implementer: ProviderId,
  tier: 'safe' | 'core',
  registry: { id: ProviderId; canReview: boolean }[],
): ReviewerChoice;
```

**Resolution algorithm** (pure, deterministic):
1. Pick the rule: `policy.byTier[tier] ?? policy.default`.
2. `pairings` rule → look up `pairings[implementer]`; if present and that provider
   is in `registry` with `canReview` **and** ≠ implementer → choose it. If absent →
   follow `onNoPairing` (`escalate`, or fall to step 3 as `any-distinct`).
3. `any-distinct` rule → choose the first `registry` entry where `canReview && id !==
   implementer` (stable registry order → deterministic). None → `escalate`.
4. Any rule that would name the implementer itself is rejected → `escalate` (the
   never-self-review invariant is enforced *here*, independent of config validity).

**Edge cases:** a pairing that names the implementer (`claude: claude`) is a config
error caught at validation (0006) *and* defended at runtime (step 4). A pairing to a
provider not in the registry, or one whose `can_review` is false → treated as
no-pairing. Single-provider registry → always `escalate` (consistent with 0042).
Unknown tier label → `default` rule. Policy omitted entirely → behave exactly as
0042 does today (`backend: review.backend` → first distinct `can_review`) so this is
backward-compatible.

## Out Of Scope

- The review cell / dispatch mechanics, verdict block, and labeling (0042 owns these;
  here we only supply the reviewer-selection decision it consumes).
- The intent-diff verdict schema and criteria-matching (0043).
- Ensemble dual-attempt + judge (0055), outcome-driven routing (0056), and the
  cost/quality routing knobs (0057) — sibling M13 tasks.
- Risk-tier derivation from changed paths (0045) — this task consumes the tier, it
  does not compute it.

## Acceptance Criteria

- [ ] `looper.yml` accepts a `review.policy` block (per-tier rules + `default`),
      validated by `@looper/config`; an invalid pairing (self-review, unknown
      provider) is rejected with a clear error.
- [ ] `selectReviewer` is pure, deterministic, and exported from `@looper/core`.
- [ ] On `tier:core` with `pairings: {claude: codex}`, a Claude-implemented PR
      resolves to a Codex reviewer; a Codex-implemented PR resolves to Claude.
- [ ] `any-distinct` (e.g. `tier:safe`) picks any distinct `can_review` provider
      deterministically; the implementer is never chosen.
- [ ] No eligible distinct reviewer (single provider, or `pairings` miss with
      `on_no_pairing: escalate`) → `decision: 'escalate'`, and 0042 routes it to
      `needs-human` rather than self-reviewing.
- [ ] Policy omitted → identical behavior to 0042 today (backward-compatible).
- [ ] 0042's `cross-model` helper calls `selectReviewer`; the existing review
      scenario test still passes, plus a new per-tier-pairing scenario.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Add the `review.policy` schema + validation to `@looper/config` (reject
      self-pairings and unknown providers at load time).
- [ ] Implement `selectReviewer` in `@looper/core/transitions/review-policy.ts` and
      export it; unit-test the resolution table and the self-review guard.
- [ ] Refactor 0042's `cross-model` reviewer-selection helper in `@looper/runtime`
      to delegate to `selectReviewer`, passing the resolved tier and provider registry.
- [ ] Thread per-loop `gates.review` override into the policy (strictest wins).
- [ ] Document the `review.policy` block in the config reference + an example loop.
- [ ] Add/extend scenario tests for per-tier pairings and the escalate path.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral/scenario tests use the M18
fakes (in-memory GitHub + fake/replay backends) — no real quota.

```bash
# core resolver unit tests (pure, no fakes)
pnpm -F @looper/core test
# config validation rejects self-pairing / unknown provider
pnpm -F @looper/config test
# runtime scenario: tier:core pairing claude->codex selects Codex reviewer;
# codex->claude selects Claude; single-provider -> escalate -> needs-human;
# policy omitted -> matches 0042 baseline.
pnpm -F @looper/runtime test
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the `review.policy` config key shape and precedence (per-loop override vs.
per-tier vs. default), the `ReviewerRule` variants (`any-distinct` vs. `pairings` +
`on_no_pairing`), the deterministic tie-break for `any-distinct` (stable registry
order), and that the never-self-review invariant is enforced in the resolver
independent of config validity.

## Risks / Rollback

- **Mis-config silently weakens review** (a pairing that always escalates stalls
  the board): validation surfaces self/unknown pairings, and the escalate path is
  visible (`needs-human`), never a silent self-review. Document the trade-off.
- **Policy/heuristic divergence**: 0042 must delegate fully to `selectReviewer` —
  leaving a second selection path would reintroduce the self-review leak; covered by
  the shared invariant assertion + scenario tests.
- Rollback: omit the `review.policy` block — selection reverts to the 0042 baseline
  with no code change (config-only, fully backward-compatible).

## Final Summary

Fill this in before marking verified.
