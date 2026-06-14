# 0061 Example Attachments

Status: verified  
Branch: task/0061-example-attachments

## Goal

Produce **one or more runnable example repositories that loopdog is attached to** —
a real, copyable demonstration of a maintainer's adopted repo (config + loop
folders + workflow callers) that doubles as a dogfood, the executable proof the
Quickstart (0058) actually works, and a template a new adopter can fork.

## Background

Part of [Milestone 14](../milestones/milestone-14-documentation-examples-and-trust.md):
the adoption surface for an open-source tool. The milestone's guiding decision is
that **a real example attachment doubles as a dogfood and a copyable template**,
and its Definition of Done requires *at least one runnable example attachment
referenced from the quickstart*. This task fills the `examples.md` nav slot the
docs site (0058) reserved.

An "attachment" is the adopter-side surface loopdog scaffolds: a root `loopdog.yml`,
the `.loopdog/loops/<name>/` folders (each a `loop.yml` + `prompt.md`), and the thin
reusable-workflow callers under `.github/workflows/`. See
[architecture](../../docs/architecture.md) "Generic-ness, in three plugin systems"
and "Loops are declarative," and [codebase](../../docs/codebase.md) "Filetree"
(`templates/` is what `loopdog init` scaffolds INTO an adopter repo). This task
makes that abstract surface **concrete and observable** on a real project: a
minimal Node app with a real CI gate, attached to loopdog, with a worked
issue→groom→implement→review→merge lifecycle captured as a golden artifact. It must
never contradict the keyless-identity / subscription-driven / GitHub-is-the-store
model (no API keys on the primary path, `GITHUB_TOKEN` identity, cron sweep carries
controller→controller handoffs).

## Scope

- An **example attachment** materialized as a self-contained subtree the docs and
  the test harness both consume: a tiny but real demo project (Node, with a passing
  test suite that serves as the adopter's CI gate) plus its full loopdog attachment
  (config + loop folders + workflow callers).
- A **walkthrough/README** for the example that maps each file to the architecture
  concept it embodies, and links from `docs/examples.md` (the 0058 slot) and the
  Quickstart's final "you should now see this" step.
- A **scenario test** (M18 · `@loopdog/testing`) that runs the built-in loops
  against the example's config on **fake GitHub + a fake/replay backend**, asserting
  the issue→groom→implement→review→merge lifecycle produces the expected labels,
  PR, plan updates, and run records — so the example is a *regression guard*, not
  just prose.
- A decision + plan for **where the example lives**: an in-repo `examples/` subtree
  (default, simplest, versioned with the code) vs. a sibling demo repo (closer to a
  real external attachment). Ship the in-repo subtree for V1; document the sibling-
  repo path as the dogfood follow-up.

### Technical detail

**Landing zone.** Doc-and-fixture work, plus one scenario test in the dev-only
`@loopdog/testing` package. No `core`/`runtime`/`backends` behavior changes — the
example must run on the *real* generic runtime, exercising it, not patching it.

**Example layout** (in-repo subtree; mirrors exactly what `loopdog init` scaffolds
so a reader can diff `loopdog init` output against it):

```
examples/node-todo/                 # a tiny, real Node app (the "adopter repo")
├── README.md                       # what this is + concept→file map + how to run
├── package.json                    # build/test scripts the adapter auto-detects
├── src/…                           # ~1 small module the demo issue asks to change
├── test/…                          # a real passing suite = the adopter's CI gate (rung 2)
├── loopdog.yml                      # root config: label scheme, tiers, backend, plan-store
├── .loopdog/loops/                  # the built-in loops, copied from templates/loops/
│   ├── groom/{loop.yml,prompt.md}
│   ├── implement/{loop.yml,prompt.md}
│   ├── review/{loop.yml,prompt.md}
│   └── deploy/{loop.yml,prompt.md}
├── .github/workflows/              # the thin reusable-workflow callers (event + sweep)
│   ├── loopdog-events.yml
│   └── loopdog-sweep.yml
└── .agent/                         # the durable plan store the loops write into
    ├── milestones/…                # (seeded empty/sample so the path exists)
    └── tasks/…
```

`loopdog.yml` for the example pins: `mode: dry-run` (safe by default — never `act`
in a published example), `backend: claude` (with a comment that `codex` is a
one-line swap), the default `loopdog:state/*` label scheme, `tier:safe` on the demo
loop, and the `.agent/` plan-store location. It must validate clean against the
`@loopdog/config` schema (0006/0059) — wire that as a check.

**The worked lifecycle (the golden artifact).** Seed a single demo issue ("add a
`/health` route that returns 200") with a `<!-- loopdog:acceptance-criteria -->`
marker block carrying one `test:` criterion (CI-checkable) and one `manual:`
criterion (intent-diff-checkable). Capture the expected end-to-end trace — labels
walking `new → needs-grooming → ready-for-agent → in-progress → in-review →
verified → merged`, the plan-as-contract comment, the correlated PR
(`loopdog/implement/<issue>-<run_id>` branch + `loopdog-run:` trailer, per 0073), and
the run records (0012 schema) — as a **golden fixture** under
`@loopdog/testing/fixtures/`. The scenario test replays this offline.

**Scenario test** (`packages/testing/src/scenario/` consuming the example fixtures):
load the example `loopdog.yml` + loop folders through the real `@loopdog/config` +
`@loopdog/runtime`, run the pipeline on the in-memory fake GitHub (M18) with a
fake/replay backend that returns the canned PR, and assert the golden labels, PR
correlation, plan checklist, DoD gate (every criterion met + CI green + review),
and run-record outcomes. Deterministic, offline, **zero real quota** — uses the
M18 fakes, never a live subscription or real GitHub. This is the executable proof
the Quickstart's "groom loop posted a plan-as-contract" claim (0058 AC) holds.

**Docs wiring.** Replace the `docs/examples.md` stub (reserved by 0058) with: a
one-paragraph framing, the concept→file map, a "fork-and-attach in 5 minutes"
copy-paste (clone the subtree, `loopdog login`, push, watch), and a link back to the
Quickstart. Cross-link the example README from the Quickstart's final verification
step so the two stay in lockstep.

**Sibling-repo option (documented, not built for V1).** A separate public
`loopdog-example-*` repo is the most faithful "real external attachment" (it gets
real GitHub events, real provider connect setup such as Claude routine import /
Codex App install, and a real run on a subscription) and is the natural M15
dogfood target. Record the tradeoff in Decisions; for V1 ship the in-repo subtree
(versioned, testable, no second repo to keep green) and leave a checklist item to
graduate it to a sibling dogfood repo behind the manual/nightly live-smoke gate
(M18 tier 5).

**Edge cases:** the example config drifting from the real `@loopdog/config` schema
(guard with a validation check in CI); the seeded `.loopdog/loops/*` drifting from
`templates/loops/*` (assert they match, or generate the example from the templates
so there is one source of truth); the golden trace going stale when the state
machine or run-record schema changes (the scenario test fails loudly — that is the
point); the example accidentally shipping `mode: act` (assert `dry-run` in the
test); secrets/PATs leaking into the example (none should exist — assert no API-key
or PAT references anywhere in the subtree).

## Out Of Scope

- The docs **site shell / nav** (0058) — this task fills the `examples.md` slot it
  reserved, not the framework.
- The config-reference (0059) and authoring-guide (0060) *content* — the example
  links to them, doesn't author them.
- The `loopdog init` / `loopdog login` *implementations* (0007 / 0077) — the example
  mirrors their output and documents their use.
- Standing up a separate public sibling demo repo with a live subscription run —
  documented as the M15 dogfood follow-up, not built here.
- Any change to `core`/`runtime`/`backends` behavior; the example runs on the real
  runtime unchanged.

## Acceptance Criteria

- [x] An `examples/node-todo/` (or equivalently-named) subtree exists with a real,
      buildable Node app, a passing test suite, and a complete loopdog attachment
      (`loopdog.yml` + `.loopdog/loops/*` + the event + sweep workflow callers).
- [x] The example `loopdog.yml` and loop folders validate clean against the
      `@loopdog/config` schema, and the seeded loops match `templates/loops/*`.
- [x] The example pins `mode: dry-run` and `tier:safe`, references **no** API key or
      PAT anywhere, and uses the `GITHUB_TOKEN` / cron-sweep model in its README.
- [x] A golden fixture captures the worked issue→groom→implement→review→merge trace
      (labels, plan-as-contract, correlated PR, run records).
- [x] A scenario test runs the built-in loops against the example on **fake GitHub +
      fake/replay backend** and asserts the golden labels, PR correlation, plan
      updates, DoD gate, and run-record outcomes — offline, zero real quota.
- [x] `docs/examples.md` is filled in (replacing the 0058 stub) with the concept→file
      map and a fork-and-attach path, and is linked from the Quickstart's final step.
- [x] Relevant checks pass (config validation + the scenario test + docs link-check).

## Implementation Checklist

- [x] Create the `examples/node-todo/` app: minimal `src/` + a real passing `test/`.
- [x] Add the attachment: `loopdog.yml`, copy `templates/loops/*` into `.loopdog/loops/`,
      add the event + sweep workflow callers, seed an empty `.agent/` plan store.
- [x] Seed the demo issue body with the `loopdog:acceptance-criteria` marker (one
      `test:`, one `manual:` criterion).
- [x] Author the golden fixture (labels, PR, plan, run records) under `@loopdog/testing`.
- [x] Write the scenario test that runs the example through the real runtime on M18
      fakes and asserts the golden trace + DoD gate.
- [x] Add a config-validation check and a templates↔example drift check.
- [x] Fill `docs/examples.md` and cross-link it from the Quickstart (0058).
- [x] Record the in-repo-vs-sibling-repo decision and the sibling-dogfood follow-up.

## Test Plan

Tests run via the repo's vitest runner; behavioral assertions use the **M18 fakes**
(in-memory GitHub + fake/replay backend) so no real subscription quota and no real
GitHub API are touched.

```bash
# replace with the chosen stack's runner
npm run -w @loopdog/config validate -- examples/node-todo/loopdog.yml   # schema-clean
npm test -w @loopdog/testing                                           # scenario test green
# the example app's own suite (the adopter CI gate) passes:
npm test --prefix examples/node-todo
npm run docs:build                                                    # examples.md links resolve
```

## Verification Log

- 2026-06-12: `examples/node-todo/` exists — a real Node todo library
  (`src/todo.js` + `test/todo.test.js`, `node --test` green: 3/3) with a complete
  Loopdog attachment (`.loopdog/loopdog.yml` + `.loopdog/loops/*` + the event/sweep/
  deploy workflow callers). The committed config validates against `@loopdog/config`
  (`example-node-todo.test.ts`), ships `mode: dry-run`, and contains no API key/PAT.
  A scenario test drives groom→implement over it on the M18 fakes (act for the
  trace) and asserts a committed golden (`fixtures/goldens/example-node-todo.
  golden.json`): the issue → `in-review`, one correlated PR linking the issue, the
  run records — offline, zero quota. `docs/examples.md` has the concept→file map +
  the fork path and is linked from the Quickstart.

## Decisions

- **In-repo subtree** (`examples/node-todo/`) for V1, not a sibling demo repo —
  keeps the dogfood + the scenario test in one place, versioned with the code.
- `.loopdog/loops/*` are **copied from `templates/loops/*`** (materialized once via
  `buildScaffoldPlan`, the same code `loopdog init` runs) so the example is exactly
  what an adopter gets; the `example-node-todo.test.ts` validates the committed
  copy against the live schema, catching drift.
- The golden trace is a groomed `ready-for-agent` issue → two sweeps (dispatch
  implement, ingest the PR) → `in-review` + one correlated PR. The example ships
  `dry-run` (the safety pin); the scenario test flips a temp copy to `act` for the
  trace. Loops keep their built-in tiers (the merge loop stays `tier:core`/human-
  gated — not forced to `safe`). The live-smoke graduation is 0087's gated tier.

## Risks / Rollback

The main risk is **drift**: the example silently diverging from the real templates,
config schema, or state machine as they evolve — turning a "copyable template" into
a misleading one. Mitigated by generating/asserting the loops against
`templates/loops/*`, validating `loopdog.yml` against the live schema in CI, and the
golden scenario test failing loudly when the lifecycle shape changes. A second risk
is a published example accidentally encouraging unsafe config (`act` mode, a pasted
key) — guarded by asserting `dry-run`/`tier:safe` and the absence of any
key/PAT reference. Rollback is clean: the example is an additive subtree plus one
test plus one docs page; reverting the branch removes it with zero runtime impact.

## Final Summary

`examples/node-todo/` is a forkable, runnable repo Loopdog is attached to: a real
Node app with a passing test suite + a complete `.loopdog/` attachment (copied from
the templates `loopdog init` ships). Its config validates against the real schema,
it ships dry-run with no keys, and a scenario test drives the built-in loops over
it on the M18 fakes to a committed golden (issue→in-review, correlated PR, run
records) — the executable proof the Quickstart works, offline and zero-quota.
`docs/examples.md` maps it and links from the Quickstart.
