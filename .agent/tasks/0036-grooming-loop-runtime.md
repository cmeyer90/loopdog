# 0036 Grooming Loop Runtime

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Wire the grooming work cell (0033) into a live, triggered loop in `@looper/runtime`:
register the built-in `groom` loop so the right GitHub events and the cron sweep
fire it, and make it ship **dry-run (comment-only)** by default with an explicit,
documented promotion to acting. This is the task that turns the groom *assets*
(0033) into something the controller actually runs end to end.

## Goal recap

No new model behavior — only the deterministic registration, trigger-eligibility,
and compose→dispatch plumbing that hangs the groom loop off looper's generic
pipeline (0012), enforced through the single mode boundary (0009).

## Background

Part of [Milestone 08](../milestones/milestone-08-grooming-and-clarification-loop.md)
— DoD lines *"The loop runs in dry-run before it is trusted to relabel"* and
*"A plan-as-contract is posted before any downstream work."* This task is the
runtime half of the first loop: the grooming work cell (0033) authors the
`templates/loops/groom/` assets and the DoR brief; **this task registers and
triggers them**. See [codebase](../../docs/codebase.md) —
`runtime/src/{pipeline,triggers,sweep,loops-builtin}/` — and
[architecture](../../docs/architecture.md#triggering-events-for-latency-cron-for-resilience).

It composes prior platform work rather than re-implementing it: the stateless
transition runner (0012), the dual triggers (events 0008 + sweep 0076), the
dry-run/`suggest`/`act` mode boundary (0009), brief composition (0022), and
dispatch/ingest correlation (0073). It is the consumer that the clarification
responder (0034) and the assume-vs-block policy (0035) plug their transitions into.

## Scope

- Register the built-in `groom` loop in `@looper/runtime`'s loop registry
  (`loops-builtin/`) so the generic pipeline (0012) can select and run it.
- Map the loop's triggers — which GitHub events and the sweep make a
  `needs-grooming` item *eligible* — onto the event workflow (0008) and the
  reconcile sweep (0076).
- Default the loop to `mode: dry-run` (comment-only preview) and document the
  one-command promotion to `act` via `looper promote` (0009).
- Wire the groom transition's compose→dispatch path: select eligible item → compose
  the DoR brief (0022) → dispatch the groom work cell to the backend (0019) → record
  the correlation handle (0073); ingest is the existing pipeline path.

### Technical detail

**Where it lands.** `@looper/runtime`, in `runtime/src/loops-builtin/` (registers
the asset) and `runtime/src/triggers/` + `runtime/src/sweep/` (eligibility wiring).
**No new pipeline code** — the groom loop is data executed by the 0012 runner; this
task only declares it and binds its triggers.

**Loop registration.** `loops-builtin/` exposes a `BuiltinLoop` record that points
the runtime at the shipped assets (authored in 0033):

```ts
// runtime/src/loops-builtin/index.ts
export const groomLoop: BuiltinLoop = {
  name: "groom",
  assetDir: "templates/loops/groom",          // loop.yml + prompt.md (0033)
  defaultMode: "dry-run",                       // 0009; safe-by-default
};
```

The registry is the list the pipeline (0012) and the CLI loop-introspection (0068)
read. An adopter `.looper/loops/groom/` overrides the built-in asset (same
resolution order as prompts, 0022); registration only supplies the default when the
adopter hasn't authored their own.

**Trigger eligibility (which events/sweep fire it).** The groom loop's
`trigger: { github_event: issues }` (0033) plus its transition `from: needs-grooming`
define eligibility. This task maps that to concrete trigger sources:

| Source | Fires groom when | Why |
|---|---|---|
| `issues` (opened/labeled/edited) event (0008) | an issue enters/sits in `looper:state/needs-grooming` | low-latency: a freshly-filed/labeled issue grooms immediately |
| `issue_comment` event (0008) | a `needs-clarification` item gets a human reply | re-entry to grooming; the reply→re-groom logic is 0034, this task only marks the loop eligible on that event |
| cron sweep (0076) | any `needs-grooming` item a webhook missed, or a controller→controller handoff into `needs-grooming` | resilience backstop; `GITHUB_TOKEN` won't re-trigger so a label looper itself wrote is only picked up by the sweep |

Eligibility is computed by the pipeline's existing selector (0012: label == `from`
state AND passes the loop's trigger filter); this task's job is to register the
event→loop and sweep→loop mappings so the selector sees `groom` as a candidate for
those sources. The event path covers human/provider-originated activity; the sweep
carries the controller→controller handoff *into* `needs-grooming` (e.g. clarification
re-entry the controller relabels). Event and sweep racing the same item is safe —
claims are atomic and transitions idempotent (0012/0013), so no special-casing here.

**Dry-run (comment-only) default — the headline.** The groom loop ships
`mode: dry-run` (declared in `loop.yml`, 0033; defaulted in registration). Under the
0009 effect boundary that means: read the issue, compose the brief, emit the full
`PlannedAction[]` ("would dispatch groom on #N; would set `needs-grooming →
ready-for-agent`") into the run record — but **post no comment, write no label, and
dispatch nothing**. The adopter watches the previews (via `looper run --dry-run` /
job summaries, 0070) until they trust the loop, then promotes:

```
looper promote groom --to act      # rewrites mode: in .looper/loops/groom/loop.yml (0009)
```

`tier: safe` (0033) means promotion is permitted (the `tier:core`-merge guard in
0009 doesn't apply to groom). This task does **not** re-implement mode enforcement —
it relies on the single decorator boundary (0009); its responsibility is to ensure
the built-in default is `dry-run` and that the promotion path is documented for the
groom loop specifically.

**Compose → dispatch wiring.** When an eligible `needs-grooming` item is selected and
mode is `act`, the pipeline (0012) runs the groom transition:

1. **Claim** the item (0013) — atomic, lease-protected.
2. **Compose** the DoR brief: `compose(ctx, source)` (0022) over
   `templates/loops/groom/prompt.md`, with `ComposeContext` filled from the issue +
   `transition: { from: needs-grooming, to: ready-for-agent }` + `run_id` +
   `branch: looper/groom/<issue>-<run_id>`. The non-overridable output-contract
   trailer (0022) is appended so the agent's plan-edit PR/comments correlate back.
3. **Dispatch** the brief to the configured backend (`backend: claude`, 0033) via
   `dispatch(brief)` (0019); record the correlation handle (0073) in the run record.
4. **Return** — dispatch is async; the agent's plan-edit PR is **ingested by a later
   invocation** (event or sweep), at which point 0016 mirrors the criteria into the
   bound plan, posts the plan-as-contract comment, and advances the label to
   `ready-for-agent`. This task owns the *dispatch* half; ingest is the shared 0073
   path the runtime already provides.

**Edge cases.**
- **Double-dispatch:** the 0012 idempotency key `(groom, item, needs-grooming)` +
  the correlation check (0073) ensure a re-invocation (event racing sweep) ingests
  the open plan-edit PR instead of dispatching twice. This task adds no new guard —
  it must simply not bypass the existing one.
- **No-result/timeout:** a dispatched groom that yields no plan-edit PR within the
  lease window is detected by the sweep (0073/0076) and escalated, not stranded.
- **Pre-flight ordering:** kill-switch/budget/quota (M12) → circuit breaker (M19) →
  authorization (M17) → DoR/DoD gate (0014) → mode (0009) all run *before* dispatch
  in the existing pipeline; the groom loop inherits them unchanged. A public-repo
  issue from a non-collaborator is parked `needs-approval`, not groomed, until released.
- **Unconnected backend in `act`:** fails closed at pre-flight (0009/0006), never
  silently degrades to dry-run.

## Out Of Scope

- The groom assets themselves — `loop.yml`, `prompt.md`, the `groom` policy
  fragment, and the golden DoR scenario test (all 0033).
- The clarification re-entry classifier/threading (0034) and the assume-vs-block
  decision rule (0035) — this task only makes the loop eligible on their events.
- The transition pipeline (0012), claim protocol (0013), mode enforcement mechanics
  (0009), brief composer (0022), and ingest/correlation matching (0073) — all
  *consumed*, not built here.
- The event workflow YAML and the sweep workflow YAML (0008/0076) — this task maps
  the groom loop onto them; it doesn't author the reusable workflows.

## Acceptance Criteria

- [x] The built-in `groom` loop is registered in `@looper/runtime` and appears as a
      selectable loop to the pipeline (0012) and `looper loops` (0068).
- [x] An `issues` event for an item entering `looper:state/needs-grooming` makes the
      groom loop eligible and (in `act`) runs exactly one groom transition.
- [x] The cron sweep (0076) picks up a `needs-grooming` item whose triggering event
      was dropped/missed, and a controller-written handoff into `needs-grooming`.
- [x] The loop defaults to `mode: dry-run`: a full run performs **zero** GitHub
      writes and **zero** dispatch, yet emits a complete `PlannedAction[]` (including
      the composed DoR brief) to the run record.
- [x] `looper promote groom --to act` flips the loop to acting; thereafter a groom
      run composes the DoR brief (0022) and dispatches to the backend (0019) with a
      recorded correlation handle (0073).
- [x] An event and a sweep racing the same `needs-grooming` item produce exactly one
      effective dispatch (idempotent; proven by a double-invocation scenario test).
- [x] The dry-run default and the promotion command are documented in the grooming
      walkthrough/adopter docs.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the `groom` `BuiltinLoop` record in `runtime/src/loops-builtin/` (asset
      dir + `defaultMode: "dry-run"`), exposed in the registry the pipeline reads.
- [x] Register the event→loop mapping (`issues`, `issue_comment`) and the sweep→loop
      mapping so the 0012 selector treats groom as a candidate on those sources.
- [x] Confirm the compose→dispatch path: groom transition fills `ComposeContext`,
      calls the composer (0022) and `dispatch` (0019), and records the 0073 handle.
- [x] Ensure the loop runs through the existing mode boundary (0009) unchanged — no
      effect bypasses the decorator; dry-run is the resolved default.
- [x] Add a scenario test (M18) for dry-run (zero writes, full `PlannedAction[]`) and
      a double-invocation event↔sweep test (single effective dispatch).
- [x] Document the dry-run default + `looper promote groom --to act` in the grooming
      walkthrough.

## Test Plan

Tests run via the repo's `vitest` runner; behavioral paths use the M18 fakes
(in-memory GitHub from 0083 + fake/replay backend) — no real GitHub, no quota.

```bash
# from repo root
npm test -w @looper/runtime   # groom registered; event/sweep eligibility; compose→dispatch wiring
npm test -w @looper/testing   # scenario: dry-run = 0 writes/0 dispatch + populated PlannedAction[]
# scenario: seed needs-grooming issue, mode dry-run → assert no label/comment/dispatch, brief in run record
# scenario: promote to act → assert one dispatch with correlation handle recorded
# simulation: deliver issues event AND run sweep on same item → exactly one effective dispatch (idempotent)
# resilience: drop the plan-edit PR → sweep escalates, item not stranded (0073/0076 path)
```

## Verification Log

- 2026-06-09: the loops e2e suite (4 scenarios on the REAL scaffolded
  templates + fakes, zero quota) is green: raw issue → triage → groom →
  implement → review → fix → merge → deploy → smoke → deployed; the
  clarification path; the blast-radius halt; the smoke-red → rollback path.
  169 tests green repo-wide.

## Decisions

No grooming-specific runtime exists — the generic pipeline (0012) executes
the groom/clarify loop assets: event trigger wiring via the matcher, sweeps as
the handoff carrier, dry-run/suggest modes from 0009 (scaffold default
dry-run). That is the 'loops are data' payoff working as designed.

## Risks / Rollback

The core risk is an autonomy leak — a "dry-run" groom that actually writes or
dispatches; mitigated by funneling every effect through the one 0009 decorator (this
task adds no direct port call) and proving zero-mutation in the scenario test. A
second risk is double-dispatch under event↔sweep races; mitigated by *not* bypassing
the existing 0012 idempotency key + 0073 correlation guard and covering it with the
simulation test. Rollback is config-only: the loop ships `mode: dry-run`, so reverting
a `looper promote` (or the registration) returns groom to observe-only with no code
change.

## Final Summary

The grooming loop runs on the generic runtime with zero loop-specific code:
trigger wiring, claim, dispatch, verdict ingest, plan sync, and comment-only
dry-run all come from the shared pipeline — exercised end-to-end in tests.
