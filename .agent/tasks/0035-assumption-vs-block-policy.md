# 0035 Assumption-vs-Block Policy

Status: planned  
Branch: task/0035-assumption-vs-block-policy

## Goal

A deterministic, config-driven decision rule that, given a groomed issue's open
questions, decides per question whether to **state an assumption and proceed** or
**block** the item into `looper:state/needs-clarification` — biased hard toward
assume-and-proceed, blocking only on genuinely ambiguous or destructive choices.

## Background

Part of [Milestone 08](../milestones/milestone-08-grooming-and-clarification-loop.md).
The milestone's guiding decision is "bias to assume-and-proceed; hard-block only on
genuinely ambiguous or destructive choices." The grooming work cell (0033) produces
a set of open questions while rewriting a raw issue to Definition-of-Ready; this
task owns the **deterministic classifier** that turns each question into either a
recorded assumption (in the plan + issue) or a clarification block. It is the policy
the event-driven clarification responder (0034) re-evaluates when a human replies,
and it feeds the DoR gate (M03 · 0014): assumptions become acceptance criteria,
blocks suspend DoR. See [architecture](../../docs/architecture.md) "The loops"
(grooming) and "How we know the request was satisfied." The logic lives in
`@looper/core` (pure, IO-free); config schema in `@looper/config`; the runtime
pipeline (0036) consumes the decision.

## Scope

- A pure classifier `classifyQuestion(q, policy) -> "assume" | "block"` and a
  batch `decideGrooming(questions, policy) -> GroomingDecision`.
- A small config block (`grooming.clarification`) for the policy knobs.
- The assumption record + the clarification-block record shapes written by 0033/0036.
- Deterministic, explainable output (every decision carries its reason).

### Technical detail

**Inputs.** The work cell (0033) tags each open question it surfaces with a
machine-readable category and a confidence the model assigns; the classifier never
calls a model itself (no API key on the primary path) — it is pure policy over
structured input:

```ts
// @looper/core/src/grooming/
interface OpenQuestion {
  id: string;                 // stable slug, e.g. "rate-limit-window"
  text: string;               // human question
  category: QuestionCategory; // see taxonomy below
  confidence: number;         // 0..1, model's stated confidence in its default
  proposedDefault?: string;   // the assumption the cell would make
  blastRadius?: "safe" | "core"; // mirrors risk tier if the question touches code
}
type QuestionCategory =
  | "destructive"     // data loss / migration / deletion / external side effect
  | "security"        // auth, secrets, permissions, exposure
  | "scope-boundary"  // in/out of scope, which surface to touch
  | "interface"       // API/CLI/schema shape others depend on
  | "behavioral"      // edge-case behavior, defaults, copy
  | "cosmetic";       // naming, wording, formatting
```

**The rule (block-list, fail-toward-assume).** A question **blocks** iff ANY:

1. `category ∈ policy.always_block` (default `["destructive", "security"]`).
2. `confidence < policy.min_confidence` (default `0.5`) AND
   `category ∈ policy.confidence_gated` (default `["scope-boundary", "interface"]`).
3. `blastRadius === "core"` AND `category ∈ policy.core_blocks` (default `["interface"]`).
4. No `proposedDefault` exists (cannot assume what you can't state).

Otherwise it **assumes**: the `proposedDefault` becomes a recorded assumption.
`behavioral`/`cosmetic` always assume regardless of confidence. The whole-item
decision: if **any** question blocks → item → `needs-clarification`; else → all
assumptions recorded, item proceeds toward `ready-for-agent` (DoR gate, 0014, runs
after).

**Config** (`@looper/config`; repo-wide in `looper.yml`, override per loop):

```yaml
grooming:
  clarification:
    always_block: [destructive, security]
    confidence_gated: [scope-boundary, interface]
    min_confidence: 0.5
    core_blocks: [interface]
    max_assumptions: 6        # > this many assumptions on one item → block (too vague)
```

**Outputs (consumed by 0033/0034/0036).**

```ts
interface GroomingDecision {
  outcome: "proceed" | "block";
  assumptions: { id; text; default: string; reason: string }[];
  blockers:    { id; text; category; reason: string }[];
}
```

- `assumptions` → rendered into a `<!-- looper:assumptions -->` block on the issue
  and into the plan; each surfaces as a `manual:`-tagged acceptance criterion so the
  human can veto at review (closing the rung-5 backstop in architecture).
- `blockers` → rendered into a `needs-clarification` comment listing each open
  question with its category; the runtime sets `looper:state/needs-clarification`.

**Re-evaluation (0034 path).** When a human comment answers a blocker, 0034 maps
the answer onto the question, lowers/removes it, and re-runs `decideGrooming`; if no
blockers remain the item proceeds. Pure function ⇒ same inputs give same decision,
making the event and sweep paths agree.

**Edge cases.** Zero questions → `proceed` (nothing to clarify). `max_assumptions`
exceeded → `block` with a synthetic "issue too underspecified" blocker (a vague
ticket is not silently assumed into a large guess). Unknown `category` → treat as
`scope-boundary` (fail toward the cautious bucket). A blocker with a non-empty
`proposedDefault` is still blocked — destructive/security never auto-assume.

## Out Of Scope

- Producing the open questions or the model judgment behind them (0033 work cell).
- Rendering/posting comments and relabeling (0036 runtime; 0034 responder).
- The DoR/DoD gate predicates themselves (M03 · 0014).
- The intent-diff that judges `manual:` criteria at review (M10 · 0043).

## Acceptance Criteria

- [ ] `classifyQuestion` returns `block` for any `destructive`/`security` question
      regardless of confidence or proposed default.
- [ ] A `scope-boundary`/`interface` question below `min_confidence` blocks; the
      same question at/above it (with a default) assumes.
- [ ] `behavioral`/`cosmetic` questions always assume when a default exists.
- [ ] An item with ≥1 blocking question yields `outcome: "block"`; an all-assume
      item yields `outcome: "proceed"` with every assumption carrying a reason.
- [ ] Exceeding `max_assumptions` blocks with the synthetic underspecified blocker.
- [ ] The function is pure and deterministic — identical inputs give identical
      `GroomingDecision` (proven by a table test); config overrides are honored.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Define `OpenQuestion`, `QuestionCategory`, `GroomingDecision` in `@looper/core`.
- [ ] Implement `classifyQuestion` + `decideGrooming` (pure; reasons on every decision).
- [ ] Add `grooming.clarification` to the `@looper/config` zod schema with defaults.
- [ ] Render the `<!-- looper:assumptions -->` block + the clarification-comment
      payload (string builders in `core`; posting stays in `runtime`/0036).
- [ ] Map assumptions to `manual:`-tagged acceptance criteria for the 0014 block.
- [ ] Table-driven unit tests across the taxonomy × confidence × config matrix.

## Test Plan

Tests run via the repo's `vitest` runner; this is pure `@looper/core` logic so the
unit tier needs **no** fakes and burns no quota. Scenario coverage (0036/M18) uses
the in-memory GitHub fake (M18 · 0083) to assert the resulting label + comment.

```bash
# replace with the chosen stack's runner
# table test: each category × {below,above} min_confidence × {core,safe} → expected outcome
# determinism: run decideGrooming twice on the same input → identical GroomingDecision
# max_assumptions+1 assumptions → outcome "block" with synthetic blocker
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final category taxonomy, the default `always_block`/`confidence_gated`
sets and `min_confidence`, and whether `max_assumptions` blocks or just warns.

## Risks / Rollback

The failure mode is mis-classification: assuming through something that should have
blocked (silent wrong work) or blocking trivia (annoying, defeats the bias). The
defense is the asymmetric default — destructive/security are unconditional blocks
and unknown categories fail toward caution — plus that every assumption is recorded
as a human-vetoable `manual:` criterion, so a bad assumption is visible at review,
not buried. Rollback: the policy is data + a pure function; tighten the block-list
in config (or set everything to block) without code changes to revert to
conservative behavior.

## Final Summary

Fill this in before marking verified.
