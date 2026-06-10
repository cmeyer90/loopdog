# 0063 End-to-End External Dogfood

Status: planned  
Branch: task/0063-end-to-end-dogfood

## Goal

Prove looper works end-to-end on at least one real **external** GitHub repo that
looper's authors don't control, on **real Claude and Codex subscriptions**,
driving real issues through groom → implement → review → merge (→ deploy where
applicable). This is the integration gate for V1: the thing every prior milestone
exists to enable, run against reality instead of fakes.

## Background

Part of [Milestone 15](../milestones/milestone-15-v1-hardening-and-release.md) —
the integration, dogfood, and ship gate. Its Guiding Decisions are explicit: **V1
is gated on a real, non-trivial external dogfood, not internal tests alone**, and
the merge loop **stays human-gated on the dogfood until the verification ladder is
proven there**. The architecture's verification ladder names dogfooding as rung 5
(the human) and the whole roadmap closes with "keep merge human-gated until the
verification ladder is proven on a real repo" (see [architecture](../../docs/architecture.md)
"V1 scope" and "The verification ladder").

This task is **execution + evidence**, not new product code. It exercises the
attach flow (M02), the state machine + sweep (M03 · 0076), both subscription
backends (M05 · 0020/0021), the loops (M08–M11), gates (M03 · 0014, M10 · 0043),
and safety (M12, M17, M19) against a live repo. The scratch-repo **live-smoke**
harness (M18 tier 5) is the nightly canary; this is the deliberate, observed,
non-trivial run that produces a signed-off report. It is distinct from those
automated smokes: it lands as a **report artifact + fixes**, not a package.

## Scope

- Select/stand up ≥1 real external dogfood repo (ideally not authored by us) with
  real Claude and Codex subscriptions attached via the documented paths: Claude
  routine import and Codex provider App.
- Run a curated batch of real issues (mix of `tier:safe` and `tier:core`,
  spanning all four loops) through the full lifecycle on the live system.
- Keep the merge loop **human-gated** throughout; promote nothing to auto-merge.
- Capture a structured dogfood report (per-issue lifecycle trace + aggregate) and
  file/fix the bugs and friction the run surfaces.
- Produce the go/no-go evidence Milestone 15's Definition of Done depends on.

### Technical detail

**Lands in:** primarily a **report artifact** under `docs/dogfood/` (e.g.
`docs/dogfood/0063-report.md`) plus whatever **fixes** the run forces across
`@looper/runtime`, `@looper/backends`, `@looper/github`, `@looper/config`,
`@looper/adapters`. No new package; this is integration + evidence. Reusable
issue/loop fixtures distilled from the run may seed `@looper/testing` scenarios
(tier 3) so regressions are caught offline thereafter.

**Repo selection criteria** (record the choice in Decisions): a real, non-trivial,
**externally-owned** Node or Python repo with green CI, branch protection +
required checks (so ladder rung 2 is real), an issue backlog, and at least one
deployable surface for the deploy loop where feasible. If a truly external repo
can't be secured for the deploy path, a looper-owned scratch repo is the fallback
for deploy **only** — but at least one external repo must carry groom→merge. State
the ToS posture (the architecture flags programmatic subscription driving as an
open question) before running at volume.

**Run matrix** — at minimum exercise, on the live system:
- **Grooming/clarification (M08):** ≥1 vague issue groomed into a
  `<!-- looper:acceptance-criteria -->` block with `test:`/`manual:` tags + a
  durable plan posted as contract; ≥1 issue that triggers event-driven
  clarification (a real human reply advances it).
- **Implementation (M09):** issues dispatched to **both** Claude (`/fire` routine,
  beta) and Codex (`@codex` mention) so cross-provider works in anger;
  correlation (M05 · 0073) recognizes each provider-opened PR via branch
  `looper/<loop>/<issue>-<run_id>` + the `looper-run:` trailer + issue ref.
- **Review/merge (M10):** cross-provider review (Codex reviews a Claude PR and
  vice-versa) + intent-diff (0043) against the criteria; `test:` criteria
  validated by the **adopter's CI** (rung 2, the gate looper can't edit); merge
  **human-gated** behind every-criterion + CI + review.
- **Deploy (M11):** where a deployable surface exists, deploy + smoke on merge,
  with rollback armed.

**Observation harness:** drive and watch via the CLI (M16) — `looper runs` for
per-issue traces (0069), `looper status` for fleet state (0071), `looper prompts`
for what was actually dispatched (0072). The run record schema (0012) is the
ground truth; the report is assembled from real run records, not prose.

**Report shape** (`docs/dogfood/0063-report.md`): repo(s) + commit/subscription
context; per-issue lifecycle table (issue → loop sequence → provider per step →
gate outcomes → run_ids → human interventions → wall-clock + quota cost); an
aggregate (issues attempted/merged/escalated/abandoned, per-provider success,
sweep-vs-event handoff latency); a **bug ledger** (each defect → severity →
fix PR / follow-up task id); and a **go/no-go** verdict for V1 with named
blocking issues. Costs/latency feed the benchmarks task (0065); security
observations feed the review task (0064).

**Safety posture for the run:** human-gated merge throughout; budgets/quota +
kill-switch (M12 · 0050) and authorization (M17 · 0080) live and enforced;
resilience policy (M19) active so a provider hiccup quarantines rather than
strands. Controller acts as `GITHUB_TOKEN`; controller→controller handoffs ride
the cron sweep (0076) — measure that handoff latency explicitly, since it's the
no-App tradeoff. An optional PAT may be tested for instant handoff and noted.

**Edge cases to deliberately provoke and record:** a dropped/missed webhook (does
the sweep recover it?); an event↔sweep race on one item (no double-dispatch); a
provider returning no PR within the dispatch timeout (sweep escalates, item not
stranded); an untrusted/stranger issue or comment (parked at
`looper:needs-approval`, no spend); a scope-exceeding implementation (halts +
escalates per blast-radius, 0038); a deliberately under-groomed issue (DoR gate
0014 refuses to start).

## Out Of Scope

- New product features or refactors beyond the bug fixes the dogfood forces.
- The automated nightly **live-smoke** harness itself (M18 tier 5) — this task
  consumes/complements it, doesn't build it.
- Publishing cost/latency numbers (0065), the security review (0064), the
  `1.0.0` release (0066), or the upgrade path (0067) — siblings this de-risks.
- Promoting any loop to auto-merge; flipping default autonomy. Merge stays human.

## Acceptance Criteria

- [ ] Looper is attached to ≥1 real **externally-owned** GitHub repo with real
      Claude **and** Codex subscriptions (Claude routine import + Codex provider
      App), via the documented attach flow (no undocumented steps).
- [ ] At least one real issue per repo is driven the full path groom → implement
      → review → merge on the live system, human-gated at merge.
- [ ] Both providers each implement ≥1 merged issue, and a cross-provider review
      runs in both directions (Codex on a Claude PR and vice-versa).
- [ ] `test:` acceptance criteria are validated by the adopter's CI (rung 2) and
      block merge when red; `manual:` criteria are checked by intent-diff (0043).
- [ ] The deploy loop runs deploy + smoke on ≥1 merge where a deployable surface
      exists (or the deploy-path gap is documented with a remediation task).
- [ ] Each provoked edge case (dropped webhook, event↔sweep race, no-PR timeout,
      untrusted trigger, scope-exceed, under-groomed) behaves per spec and is
      logged.
- [ ] `docs/dogfood/0063-report.md` exists with per-issue traces (from real run
      records), the aggregate, the bug ledger, and a go/no-go verdict.
- [ ] Every blocking defect is fixed (PR linked) or filed as a tracked follow-up
      task with severity; non-blocking friction is logged.
- [ ] No real subscription quota is spent by the repo's automated test suite —
      the dogfood run is the only live spend, and it's bounded by budgets/quota.

## Implementation Checklist

- [ ] Select the dogfood repo(s); record choice + ToS posture in Decisions.
- [ ] Run `looper init` + attach: import Claude routines, install the Codex
      provider App, configure subscriptions, land `looper.yml` + the four built-in
      loops + workflows.
- [ ] Curate the issue batch (tier mix; coverage of all four loops + edge cases).
- [ ] Execute the run, gated; drive/observe via the M16 CLI; let the sweep carry
      handoffs and measure its latency.
- [ ] Provoke each listed edge case and capture the outcome.
- [ ] Assemble `docs/dogfood/0063-report.md` from real run records (per-issue +
      aggregate + bug ledger + go/no-go).
- [ ] Fix blocking defects (link PRs) or file tracked follow-ups; distil reusable
      cases into `@looper/testing` scenarios where cheap.

## Test Plan

This task's "test" is the **live dogfood run itself** plus the offline regressions
it seeds. Live verification happens on the external repo (real subscriptions); the
repo's own suite must never touch real quota.

```bash
# offline regression seeded by the run (vitest; @looper/testing fakes, no quota):
pnpm --filter @looper/testing test          # scenario/sim cases distilled from the run
# live dogfood (manual, observed — NOT a CI gate; real subscriptions):
looper runs --repo <dogfood-repo> --since <start>     # per-issue traces from run records
looper status --repo <dogfood-repo>                   # fleet state during the run
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record: the dogfood repo(s) chosen and why (external/non-trivial); the ToS posture
taken before volume; which provider implemented which issues; the deploy-path
decision (real surface vs. documented gap); and the go/no-go verdict with its
named blockers.

## Risks / Rollback

- **ToS / quota-driving is an open question** (architecture, both providers):
  start with a tiny batch, watch for provider pushback, scale only if clean.
- **Real subscription spend** — keep budgets/quota + kill-switch (0050) live and
  the batch small; merge human-gated means a bad PR costs review time, not prod.
- **Provider API drift** (routines are beta) may break dispatch/ingest mid-run —
  the circuit breaker (M19) should pause, not burn; record drift for 0064/0066.
- **No external repo securable** — fall back to a looper-owned scratch repo for
  deploy only, but at least one external repo must carry groom→merge; if even that
  fails, this task is **NO-GO for V1** and that's the finding to report.
- Rollback is trivial: the dogfood touches a foreign repo via human-gated merges;
  nothing here ships looper code by itself beyond the report + any fix PRs.

## Final Summary

Fill this in before marking verified.
