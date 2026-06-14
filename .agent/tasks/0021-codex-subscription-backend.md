# 0021 Codex Subscription Backend

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Implement the execution-backend interface (0019) for **Codex** on the user's
subscription — dispatch by posting a GitHub `@codex` mention/assignment (there is
**no Codex cloud REST API**), then ingest the PR / `@codex review` comments the
Codex cloud agent produces — with no model API key.

## Background

Part of [Milestone 05](../milestones/milestone-05-model-provider-abstraction.md).
Verified capabilities (2026-06): Codex cloud runs a per-task container whose
**only unattended dispatch surface is a GitHub `@codex` mention / assignment**;
there is no REST API for cloud tasks, `@codex review` triggers a review on a PR,
Codex **strips secrets before the agent phase** and **disables agent-phase
internet by default**, and the cloud is rate-capped (~5 tasks/hr on lower tiers).
See [architecture](../../docs/architecture.md) "Dispatch surfaces" and "The honest
constraints," and [codebase](../../docs/codebase.md) — this lands in
`@loopdog/backends` (`backends/src/codex/`), implementing the `Backend` port in
`@loopdog/core`. Correlation/ingest mechanics are shared from the sweep+correlation
primitive (0073); the controller that calls this is the transition runner
(M03 · 0012).

## Scope

- A `CodexBackend` implementing the 0019 `Backend` interface, mention-only dispatch.
- Accurate restricted capability metadata (mention trigger, setup-only secrets,
  off network, the ~5 tasks/hr cap) so the runner adapts.
- Dispatch by posting an `@codex` mention/assignment comment via the GitHub port.
- Ingest the resulting PR and `@codex review` comments via the 0073 correlation.
- A pre-flight **capability-mismatch check** that surfaces loops whose gates need
  what Codex cannot give (live secrets / agent-phase network).

### Technical detail

**Capabilities** (consumed by the runner 0012 + budget/quota M12 · 0075):

```
capabilities() -> {
  trigger_modes: [mention],          # @codex mention/assignment ONLY — no api_fire
  runs_sandbox: true,                # provider hosts a per-task container
  secret_phase: setup-only,          # secrets present at setup, STRIPPED before agent phase
  network: off,                      # agent-phase internet disabled by default
  opens_pr: true, supports_review: true,
  throughput: { tasks_per_hour: 5 } # default lower-tier cap; config-overridable
}
```

**Auth**: dispatch is just a GitHub comment, so it uses the controller's existing
`GITHUB_TOKEN` (M01) via `@loopdog/github` — **no Codex token or API key is
stored**. The Codex cloud agent acts under OpenAI's own GitHub App on the adopter's
install; provisioning that App is the adopter's one-time setup (documented, M02),
not loopdog's job.

**Dispatch** (`dispatch(brief, context) -> DispatchHandle`): post a single GitHub
issue/PR comment via the GitHub port containing the `@codex` mention plus the
composed brief — e.g. `@codex implement this:\n\n<brief>` for issues, or
`@codex review` on a PR for the review stage (selected by the loop's
`backend.codex.mode: implement|review`). Because there is **no dispatch-time
provider handle** (the comment returns no Codex task id), the `DispatchHandle`
carries the run_id, the posted comment id (for de-dup), and the **expected branch
`loopdog/<loop>/<issue>-<run_id>`** — correlation leans entirely on
branch/trailer/issue-ref (0073), not a provider id. The brief MUST instruct the
agent to branch with that name and include the `loopdog-run: <run_id>` PR trailer.

**Ingest** (`ingest(github_event) -> IngestResult | null`): on `pull_request` /
`issue_comment` events, delegate to the 0073 matcher (branch → trailer → issue
ref). A matched PR returns `{ pr, status }`; a matched `@codex review` comment
returns the review verdict for the review stage; an unrelated event returns `null`.
Idempotency and the no-result/timeout path are owned by 0073 + the cron sweep
(0076) — a mention that yields no PR within the lease is escalated by the sweep,
never stranded.

**Rate-cap awareness**: dispatch is gated by the budget/quota pre-flight
(M12 · 0075) using `throughput.tasks_per_hour`; when the cap is exhausted the
runner defers (re-queues for the next sweep) rather than firing and failing. Codex
gives no quota-remaining API, so loopdog models the cap from observed dispatch
timestamps in recent run records.

**Capability-mismatch surfacing** (the special focus): expose a pure
`checkCompatibility(loopGates, capabilities) -> Mismatch[]` in
`backends/src/codex/` (or shared in `backends/src/interface/`). A gate requiring
live secrets (`secret_phase: full`) or agent-phase network (`network: on`) against
Codex's `setup-only`/`off` is a mismatch — e.g. a secret-dependent integration-test
loop pointed at Codex. Mismatches are reported at `loopdog loops validate` /
`doctor` time (warning, with the directive: route that gate to the adopter's CI —
the trustworthy gate runs regardless of backend — or to the self-hosted backend
0074), and re-checked at dispatch pre-flight so a misconfigured loop fails loud
before spending a cloud task.

## Out Of Scope

- The correlation/ingest mechanics + sweep timeout themselves (0073/0076).
- The Claude backend (0020); the self-hosted/API backend (0074).
- The interface/capability schema definition (0019); brief composition (0022).
- Provisioning OpenAI's GitHub App (adopter onboarding, M02).

## Acceptance Criteria

- [x] `CodexBackend` conforms to the 0019 interface with capabilities exactly
      `trigger_modes:[mention]`, `secret_phase:setup-only`, `network:off`,
      `throughput.tasks_per_hour` set.
- [x] `dispatch` posts an `@codex` mention/assignment via `GITHUB_TOKEN` with the
      composed brief and the expected branch/trailer instructions, storing **no**
      model API key and capturing no dispatch-time provider id.
- [x] `ingest` correlates the resulting PR / `@codex review` comment to the run via
      0073 (branch/trailer/issue-ref) and returns an IngestResult; unrelated events
      return `null`.
- [x] The review mode posts `@codex review` on a target PR and ingests the verdict.
- [x] A loop whose gate needs live secrets or agent-phase network is flagged as a
      capability mismatch at validate/doctor time and at dispatch pre-flight.
- [x] Dispatch respects the ~5 tasks/hr cap via the budget/quota pre-flight,
      deferring rather than over-dispatching.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Implement `CodexBackend.capabilities()` with the restricted metadata.
- [x] Implement mention/assignment `dispatch` over the GitHub port (no provider id),
      with implement vs. `@codex review` modes from loop config.
- [x] Implement `ingest` delegating to the 0073 correlation matcher + null path.
- [x] Implement `checkCompatibility` + wire it into validate/doctor and the
      dispatch pre-flight.
- [x] Model the tasks/hr cap from run-record timestamps for the quota pre-flight.
- [x] Register `codex` in the backend registry; add fakes to `@loopdog/testing`.

## Test Plan

Tests run via the repo's vitest runner; all provider interaction goes through the
M18 fakes (in-memory GitHub + a fake Codex backend) — no real Codex quota consumed.

```bash
# unit: capabilities() returns the restricted shape; checkCompatibility flags a
#       secret/network gate against Codex and passes a CI-only gate
# component: dispatch posts the @codex comment via fake-github (asserts body +
#       branch/trailer instructions, no provider id); simulate the agent's PR →
#       ingest correlates once via 0073; an unrelated PR → ingest returns null
# component: review mode posts `@codex review` and ingests the verdict
# component: quota pre-flight defers a 6th dispatch within the hour
```

## Verification Log

- 2026-06-09: backend suite green: mention dispatch posts one @codex comment
  with the branch/trailer contract (no provider id exists, by design);
  restricted capabilities exactly as specced (mention/setup-only/off/5 per hr);
  review mode posts `@codex review` and ingests the codex-bot verdict comment;
  capability mismatch flags secret/network gates with a self-hosted directive
  and passes CI-only gates. Live @codex round-trip + the bot-mention question
  remain operator-pending (0093 RUNBOOK §2).

## Decisions

- Mention body: `@codex <brief>` for cloud tasks; `@codex review

<brief>`
  for the review stage. Mode selector: the loop's `expects` (comment = review
  stage) rather than a new loop.yml key — one less knob.
- Capabilities exactly the restricted shape; tasksPerHour default 5,
  constructor-overridable for higher tiers.
- Cap modeling from run-record timestamps belongs to the quota gate
  (M12 · 0075) — the backend exposes the cap, the gate enforces it.
- `checkCompatibility` lives in `backends/src/interface/` (shared with 0074);
  consumed at validate time and dispatch pre-flight.
- The 0092/0093 bot-identity risk is encoded in `loopdog connect codex`
  guidance (LOOPDOG_CODEX_MENTION_TOKEN as the user-attributable identity).

## Risks / Rollback

- **No dispatch-time handle** makes correlation wholly dependent on 0073; if the
  agent ignores the branch/trailer instruction, ingest can miss — land/spike 0073
  against real Codex before enabling this backend in `act` mode.
- **Mention syntax / Codex behavior may change** (undocumented, no API contract);
  isolate the mention string + parsing so a change is a one-file fix, and fail loud
  on no-result via the sweep.
- Rollback: disable the `codex` backend in the registry / loop config; loops fall
  back to Claude (0020) or self-hosted (0074) with no schema change.

## Final Summary

`CodexBackend`: mention-only dispatch via the controller's GitHub identity
(no provider credential ever held), restricted capabilities the runner adapts
to, review-mode verdict ingest, shared correlation for PRs, and the
capability-mismatch check that routes secret/network-dependent gates to CI or
the self-hosted backend.
