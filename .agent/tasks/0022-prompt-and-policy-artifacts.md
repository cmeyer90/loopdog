# 0022 Prompt & Policy Artifacts

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Make every brief loopdog dispatches come from **versioned, reviewable repo files**
— per-loop `prompt.md` + layered policy fragments + optional per-backend overlays —
resolved and composed deterministically into the `brief` that `dispatch()` (0019)
consumes. No prompt text lives inline in loopdog's code.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md).
A milestone Guiding Decision: *"Prompts/briefs/policies are versioned, reviewable
repo artifacts, not inline strings,"* and a tenet of the
[architecture](../../docs/architecture.md) ("Everything-as-artifact"). This task
owns **artifact resolution + brief composition**: the runner's compose step (M03 ·
0012) calls it; the result is handed to the backend's `dispatch(brief)` (0019) and
recorded as `brief_ref` in the run record (0012). The brief must carry the
correlation instructions the ingest path (0073) relies on, and is the document the
acceptance-criteria contract (M03 · 0014, grooming M08) gets injected into. Built-in
prompts ship as `templates/loops/<name>/prompt.md` assets in `@loopdog/runtime`;
adopters override them in their own repo. Lands in `@loopdog/backends`
(`src/brief/`), reading config from `@loopdog/config` (0006).

## Scope

- A layered artifact model: built-in default `prompt.md` → adopter per-loop
  `prompt.md` → optional per-backend overlay → composed brief.
- A deterministic, pure **composer** that assembles the brief from layers + live
  context (issue, acceptance criteria, repo facts, output contract, correlation
  instructions) and emits a stable `brief_ref` version handle.
- Shared **policy fragments** (`.loopdog/policies/*.md`) referenced by name so
  common guidance (output contract, secret-hygiene, style) is authored once and
  reused across loops.
- A `loopdog prompts` surface (show/diff/lint) so operators can see exactly what
  will be sent before it spends quota.

### Technical detail

**Files (in the adopter repo).**
```
.loopdog/loops/<loop>/prompt.md              # the loop brief (overrides built-in)
.loopdog/loops/<loop>/prompt.<backend>.md    # optional per-backend overlay (claude|codex|self-hosted)
.loopdog/policies/<name>.md                  # shared fragments (output-contract, secret-hygiene, …)
templates/loops/<loop>/prompt.md            # built-in default, shipped by @loopdog/runtime
```
`prompt.md` is Markdown with a small mustache-style placeholder set (no logic, no
includes-of-includes) plus a `{% policy <name> %}` directive that inlines a shared
fragment. Placeholders are a **fixed, validated vocabulary** drawn from the compose
context — unknown placeholders fail lint, not silently render empty:
`{{issue.title}} {{issue.number}} {{issue.body}} {{acceptance_criteria}}
{{transition.to}} {{run_id}} {{branch}} {{repo.default_branch}} {{adapter.test_cmd}}`.

**Types (`@loopdog/backends/src/brief/`).**
```ts
type PromptArtifact = { loop: string; backend?: BackendId; path: string;
  source: 'builtin' | 'repo'; sha: string; body: string };
type ComposeContext = {                 // supplied by the runner (0012)
  issue: { number: number; title: string; body: string };
  acceptanceCriteria: string;           // the loopdog:acceptance-criteria block (0014)
  transition: { from: string; to: string };
  runId: string; loop: string; backend: BackendId;
  branch: string;                       // loopdog/<loop>/<issue>-<run_id> (0073)
  repo: { defaultBranch: string }; adapter: { testCmd?: string };
};
type Brief = {                          // the object 0019 dispatch() receives
  text: string;                         // fully-rendered prompt
  outputContract: string;               // "open a PR labeled in-review, branch …, trailer loopdog-run: …"
  ref: string;                          // brief_ref, e.g. "implement/prompt.md@<sha8>"
  policies: string[]; };                // fragment names inlined, for audit
compose(ctx: ComposeContext, src: PromptSource): Brief
```

**Resolution order (most-specific wins):** built-in `templates/…/prompt.md` →
adopter `.loopdog/loops/<loop>/prompt.md` → `prompt.<backend>.md` overlay. The
overlay is a full replacement of the base body (simplest, least surprising); shared
text stays in a `{% policy %}` fragment rather than being merged. `PromptSource`
abstracts where files come from so the composer is pure and testable against the
M18 fakes (no filesystem in unit tests).

**Versioning / `brief_ref`.** The ref is `"<loop>/prompt.md@<sha8>"` where the sha
is over the *resolved layered body before placeholder substitution* (so the same
template + different issue is the same prompt version). The composer also snapshots
the fully-rendered `text` into the run record (0012 `brief_ref` + composed-brief
snapshot) so a run is reproducible and auditable. Because prompts are repo files,
their git history *is* the version log; the sha is the cross-link.

**Output contract + correlation (defense in depth, 0073).** The composer always
appends a non-overridable trailer block instructing the agent to: branch
`loopdog/<loop>/<issue>-<run_id>`, put `loopdog-run: <run_id>` in the PR body, label
the PR per `transition.to`, and reference `#<issue>`. This lives in a built-in
`output-contract` policy fragment and is injected even if the adopter's `prompt.md`
forgets it — correlation is load-bearing and must not be editable away.

**Secret hygiene.** A built-in `secret-hygiene` fragment + a lint rule reject any
literal that matches a secret pattern (token/key regexes) in `prompt.md` so adopters
can't bake credentials into a model-visible artifact (architecture: "the model never
sees a long-lived credential").

**CLI (`@loopdog/cli`, thin; thread through 0069/0078).**
`loopdog prompts show <loop> [--backend b] [--issue N]` → prints the exact brief;
`loopdog prompts diff <loop>` → built-in vs. adopter override; `loopdog prompts lint`
→ unknown-placeholder / missing-policy / secret-literal errors.

**Edge cases:** missing `prompt.md` and no built-in → validation error (don't
dispatch an empty brief); a `{% policy %}` referencing an unknown fragment → lint
fail; an overlay for a backend the loop doesn't use → ignored with a warning; an
acceptance-criteria block absent → the DoR gate (0014) already blocks, but the
composer still renders `{{acceptance_criteria}}` as an explicit "none — do not
proceed" sentinel for safety.

## Out Of Scope

- The backend interface + `dispatch`/`ingest` themselves (0019); correlation
  matching mechanics (0073); per-loop **backend selection** and subscription auth
  (0023).
- Authoring/grooming the acceptance-criteria *content* (M08); the `loop.yml` schema
  (0006) — this task consumes config, doesn't define it.
- The `loopdog loops new` questionnaire that scaffolds the folder (M16 · 0078).

## Acceptance Criteria

- [x] Briefs are composed from repo files; no prompt text is hardcoded in loopdog
      source (a grep for inline prompt strings in `backends`/`runtime` is clean).
- [x] Resolution order (built-in → repo `prompt.md` → `prompt.<backend>.md`) works,
      with most-specific winning, proven by tests over a fixture tree.
- [x] `compose(ctx, src)` is pure and deterministic: same inputs → byte-identical
      `text` and `ref`.
- [x] `brief_ref` is a stable `<loop>/prompt.md@<sha8>` over the resolved
      pre-substitution body, and the rendered brief is snapshotted to the run record.
- [x] The non-overridable output-contract trailer (branch + `loopdog-run:` + label +
      issue ref, per 0073) is always present even if the adopter's prompt omits it.
- [x] Shared `{% policy <name> %}` fragments inline correctly and are listed in
      `Brief.policies`.
- [x] `loopdog prompts show/diff/lint` work; lint fails on unknown placeholder,
      missing policy fragment, and secret-literal patterns.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Define `PromptArtifact` / `ComposeContext` / `Brief` / `PromptSource` types.
- [x] Implement layered resolution (built-in → repo → backend overlay).
- [x] Implement the pure composer: placeholder substitution + `{% policy %}`
      inlining + appended output-contract trailer + `ref` derivation.
- [x] Ship built-in `output-contract` and `secret-hygiene` policy fragments and
      built-in per-loop `prompt.md` assets in `@loopdog/runtime`.
- [x] Implement the lint rules (placeholder vocab, policy refs, secret literals).
- [x] Wire the composer into the runner compose step (0012) + run-record snapshot.
- [x] Add `loopdog prompts show/diff/lint` commands.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral cases use the M18 fakes (fake
`PromptSource` + fake GitHub) — no real quota.

```bash
# replace with this repo's checks
npm test -w @loopdog/backends      # composer purity, resolution order, ref stability
npm test -w @loopdog/cli           # prompts show/diff/lint over fixtures
# golden: compose a known ctx over a fixture loop → assert byte-identical brief + ref
# negative: secret-literal prompt → lint fails; unknown {% policy %} → lint fails
```

## Verification Log

- 2026-06-09: compose suite green: resolution order (builtin→repo→backend
  overlay, most-specific wins); pure/deterministic compose with stable
  pre-substitution `<loop>/prompt.md@<sha8>` refs (same template + different
  issue = same ref); the output contract present even when the prompt omits
  it AND when a repo policy tries to override it; policy fragments inlined +
  audited; missing-criteria sentinel; lint failures for unknown placeholders/
  policies/secret literals (secrets never echoed). `loopdog prompts
  show/diff/lint` smoke-tested end-to-end on a scaffolded repo.

## Decisions

- Placeholder vocabulary fixed per spec (10 entries, validated by lint);
  no logic, no nested includes.
- Overlay = full replacement of the base body (simplest, least surprising);
  shared text belongs in {% policy %} fragments.
- `brief_ref` hashes the resolved PRE-substitution body (template identity,
  not issue identity); the rendered text snapshots into the run record via
  the runner's compose step.
- Non-overridable trailer mechanism: `{% policy output-contract %}` ALWAYS
  resolves to the built-in fragment (repo overrides ignored for that name),
  and the contract is appended when absent — covered by the 'sneaky' test.
- Built-in fragments (output-contract, secret-hygiene) are embedded constants
  in `@loopdog/backends` so the bundled CLI carries them.

## Risks / Rollback

If the output-contract trailer is overridable or drops, correlation (0073) breaks
and runs strand/double-dispatch — keep it non-editable and covered by a test.
Placeholder/templating scope creep (loops, conditionals) would turn prompts into
code; keep the vocabulary fixed and logic-free. Rollback is config-only: revert to
the built-in `prompt.md` assets, no code change needed.

## Final Summary

`@loopdog/backends/brief`: the layered artifact model (builtin → repo →
backend overlay), shared {% policy %} fragments, a pure deterministic composer
with stable version refs and the non-editable-away output contract, secret/
placeholder/policy lint, and the `loopdog prompts show|diff|lint` operator
surface — wired into the runner's compose step (briefs come only from
versioned repo files).
