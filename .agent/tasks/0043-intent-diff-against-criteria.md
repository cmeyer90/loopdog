# 0043 Intent-Diff Against Criteria

Status: planned  
Branch: task/0043-intent-diff-against-criteria

## Goal

Define the **intent-diff judgment**: a deterministic, two-layer check that the PR
delivers every acceptance criterion. `test:`-tagged criteria are validated
objectively by the adopter's CI (rung 2); this task owns the `manual:`-tagged
criteria — judged by a cross-provider reviewer that emits a per-criterion verdict,
which deterministically (un)checks each criterion box and routes a split result to
the fix-and-revalidate sub-loop (0044) rather than to verified.

## Background

Part of [Milestone 10](../milestones/milestone-10-review-verification-ladder-and-merge-loop.md).
The verification ladder and "how we know the request was satisfied" in
[architecture](../../docs/architecture.md#the-verification-ladder-trust) define the
contract: criteria live in a `<!-- looper:acceptance-criteria -->` marker block
(M03 · 0014), `test:` ones reduce to "do the acceptance tests pass?", and the rest
are judged by a cross-provider intent-diff (rung 3). This task turns that
one-liner into a concrete brief contract + verdict schema + checkbox state machine.
The cross-model reviewer cell (0042) provides the *who* (a provider ≠ implementer)
and dispatch; 0043 provides the *what to ask and how to read the answer*. Pure
judgment-mapping logic lands in `@looper/core/gates`; the brief asset + ingest
wiring land in `@looper/runtime`. The DoD gate (0014) consumes the resulting
checkbox state.

## Scope

- The **reviewer brief contract**: what the intent-diff reviewer is asked, scoped
  to the `manual:` criteria + the durable plan, and the structured output it must
  return.
- A **per-criterion verdict schema** and its deterministic mapping to the
  acceptance-criteria checkbox state in the issue/plan.
- The **split-verdict routing rule**: all-met → advance toward verified; any
  unmet/uncertain → fix-and-revalidate (0044).

### Technical detail

**Reviewer brief contract** (asset `templates/loops/review/intent-diff.prompt.md`,
composed by the runtime). The brief is scoped — it asks ONLY about `manual:`
criteria so the reviewer never re-litigates what CI already owns:

- Inputs injected: the PR diff/ref, the durable plan task body, and the parsed
  `manual:` criteria list (id + text). `test:` criteria are listed read-only as
  "validated by CI — do not judge."
- Instruction: for **each** `manual:` criterion, decide `met | unmet | uncertain`
  and cite **evidence** (file/line, diff hunk, or "not found"). No aesthetics; the
  question is "does the PR deliver *this criterion*," not "is this good code."
- Required output: a single fenced block the runtime parses (see schema). The
  brief states that free-form prose is ignored — only the block is read.

**Per-criterion verdict schema** (parsed from the reviewer's PR comment; types in
`@looper/core`):

```ts
type CriterionStatus = 'met' | 'unmet' | 'uncertain';
interface CriterionVerdict {
  criterion: string;   // stable id matching the criteria block (e.g. hash/index)
  status: CriterionStatus;
  evidence: string;    // file:line / diff ref / "not found" — required, non-empty
}
interface IntentDiff {
  run_id: string;            // correlates to the review run (0073)
  reviewer_backend: string;  // must differ from implementer (0042 enforces)
  verdicts: CriterionVerdict[];
}
```

Emitted as a fenced `intent-diff` block (YAML/JSON) in the reviewer's PR comment so
it correlates like any other ingested artifact (branch/marker/issue ref, 0073).

**Deterministic checkbox mapping** (the load-bearing rule — the model proposes, the
controller decides). After ingest, for each `manual:` criterion the runtime
rewrites its checkbox in the marker block:

- `met` → `- [x]`.
- `unmet` or `uncertain` → `- [ ]` (uncertain is treated as NOT met — fail closed;
  a criterion advances only on an explicit `met`).
- A criterion with **no verdict** in the block, or a verdict that fails schema
  (missing/empty `evidence`, unknown `status`) → left `- [ ]` and flagged as a
  parse failure (fail closed, matching 0014's parse-failure stance).
- `test:` criteria are NEVER touched here — their boxes are owned by the CI-driven
  path; the runtime asserts it only mutates `manual:` rows.

Both the issue-body marker block and the durable plan checklist are updated
(plans store, M04) so the audit record matches.

**Split-verdict routing.** Compute `allMet = every manual: criterion is now [x]`:

- `allMet === true` → the review transition advances the item toward verified (the
  loop's `to` state); the DoD gate (0014) then makes the final merge call with CI +
  approval + smoke.
- `allMet === false` → set the item to the fix-and-revalidate state and hand the
  unmet/uncertain verdicts (with evidence) to the sub-loop (0044) as the fix brief.
  The PR does **not** advance to verified. After 0044 re-runs checks and
  re-requests review, intent-diff runs again on the new commit (idempotent per
  run_id, 0073) until `allMet` or escalation (M12).

**Edge cases:** zero `manual:` criteria → intent-diff is a trivial pass (`allMet`,
nothing to judge), CI/review still gate. Reviewer returns extra verdicts for
unknown criteria → ignored (logged). Implementer == reviewer backend → reject
before ingest (0042 invariant; 0043 asserts it). Reviewer comment with no fenced
block → parse failure → fail closed → route to 0044/escalation, never to verified.

## Out Of Scope

- Dispatching/selecting the reviewer provider and the reviewer≠implementer
  invariant (0042).
- Validating `test:` criteria — that is CI (rung 2) via the DoD gate (0014).
- Applying fixes / re-running checks (the sub-loop, 0044); final merge authority
  and tiers (0045); parsing/format of the criteria block itself (0014).

## Acceptance Criteria

- [ ] The reviewer brief is composed from the durable plan + the `manual:` criteria
      only, and instructs a per-criterion `met|unmet|uncertain` + evidence output.
- [ ] A reviewer `IntentDiff` block parses into typed `CriterionVerdict[]`;
      malformed/missing-evidence verdicts fail closed (criterion stays unchecked).
- [ ] `met` deterministically checks the criterion box; `unmet` and `uncertain`
      leave it unchecked; `test:` rows are never mutated by this path.
- [ ] When every `manual:` criterion is `met`, the item advances toward verified.
- [ ] **When at least one criterion is NOT met, the PR does NOT advance to verified
      and is routed to the fix-and-revalidate sub-loop (0044) with the unmet
      verdicts + evidence.**
- [ ] Re-ingesting the same review comment is idempotent (no double routing).
- [ ] Both the issue marker block and the durable plan checklist reflect the new
      state.

## Implementation Checklist

- [ ] Add `CriterionVerdict` / `IntentDiff` types + the verdict→checkbox mapper to
      `@looper/core/gates` (pure, IO-free).
- [ ] Implement the `allMet` predicate + split-routing decision in `core`.
- [ ] Author `templates/loops/review/intent-diff.prompt.md` (the brief asset) in
      `@looper/runtime`.
- [ ] Wire ingest (0073) → parse `intent-diff` block → apply checkbox mapping →
      update issue + plan → route to verified or 0044.
- [ ] Enforce: only `manual:` rows mutated; parse/schema failure → fail closed.

## Test Plan

Tests run via the repo's vitest runner; behavioral paths use the M18 fakes
(fake GitHub + fake/replay backend) — no real quota, deterministic, offline.

```bash
# replace with the chosen stack's runner
# unit (core): verdicts → checkbox state; met→[x], unmet/uncertain/missing→[ ]; test: rows untouched
# unit (core): allMet split → verified vs. fix-and-revalidate routing decision
# scenario (fakes): all manual: criteria met → item advances toward verified
# scenario (fakes): one criterion unmet → PR does NOT advance to verified, routes to 0044 with evidence
# scenario (fakes): malformed reviewer block → fail closed → routes to 0044/escalation, never verified
# scenario (fakes): same review comment ingested twice → single effect (idempotent)
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the final verdict-block format (YAML vs JSON), the criterion-id scheme used
to match verdicts to rows, the uncertain=unmet fail-closed rule, and how unmet
verdicts are shaped into the 0044 fix brief.

## Risks / Rollback

A lenient mapping (treating `uncertain` as met, or passing on parse failure) lets
unmet work reach verified — the core risk. Defense: fail closed everywhere
(advance only on explicit `met`; parse failure → unchecked + route to 0044). A
reviewer that hallucinates `met` with bogus evidence is bounded by CI (rung 2) and
the human backstop (rung 5); evidence is required so a human can audit. Rollback:
disable the review loop's auto-advance so every PR routes to human/0044 — never to
verified — while the mapping is re-tuned.

## Final Summary

Fill this in before marking verified.
