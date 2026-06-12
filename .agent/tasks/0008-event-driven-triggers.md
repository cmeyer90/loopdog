# 0008 Event-Driven Triggers

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Make loops **react instantly** to GitHub activity: reusable Actions workflows that
fire the controller on the relevant `on:` events and advance the affected item.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md);
one half of looper's dual-trigger model (the other is the cron sweep, 0076). See
[architecture](../../docs/architecture.md) "Triggering: events for latency, cron
for resilience." Events give **low latency**; the sweep gives **completeness**.
Together they are *watch + periodic resync*.

## Scope

- Reusable workflow(s) the adopter references (not copy-pastes) that trigger the
  controller on the lifecycle-relevant events.
- Map each event to the eligible loop(s) via config; the controller (M03 · 0012)
  decides what to advance.
- Run under the Actions `GITHUB_TOKEN` (M07) — no looper App.

### Technical detail

- **GitHub Actions *is* the webhook receiver** — there is no looper-hosted endpoint;
  `on:` delivers events natively into the adopter's Actions.
- **Canonical event/action matrix (V1)** — this is the source of truth for
  `github/src/events`, config validation (0006), trigger-source filtering (0081),
  custom-loop authoring (0078), and fake-GitHub event emission (0083):

| GitHub workflow trigger | Payload actions / predicates Looper honors | Loop consumers |
|---|---|---|
| `issues` | `opened`, `edited`, `reopened`, `labeled`, `unlabeled` | `groom` for raw/new/needs-grooming issues; `implement` when a trusted non-controller label makes an issue `ready-for-agent`; approval/hold release via `looper:approved`; state/plan reconciliation on item-label drift. |
| `issue_comment` | `created`, `edited` on issues or PRs | Clarification replies (0034); `@looper` directives such as approve/retry/stop; provider or reviewer verdict comments that carry a `looper-run:` marker. |
| `pull_request` | `opened`, `reopened`, `synchronize`, `ready_for_review`, `converted_to_draft`, `labeled`, `unlabeled`, `closed` | Provider PR ingest/correlation (0073); review loop eligibility on opened/synchronize; tier/ladder re-evaluation on synchronize; approval/state-label release on PR labels; deploy on `closed` **only when** `pull_request.merged == true`. |
| `pull_request_review` | `submitted`, `edited`, `dismissed` | Cross-provider review verdict ingest (0042/0043); human approval/changes-requested signals that feed the verification ladder and merge gate. |
| `check_run` | `completed` (optionally `rerequested` to mark pending) | Non-Actions check-app CI/deploy-smoke completion; verification ladder, merge policy, rollback/deploy gates. |
| `check_suite` | `completed` | Non-Actions aggregate CI/deploy completion; same consumers as `check_run`. |
| `status` | no `action`; inspect `state` (`success`, `failure`, `error`, `pending`) | Classic commit-status CI providers; verification ladder and merge policy. |
| `workflow_run` | `completed` for configured required GitHub Actions workflows | GitHub Actions CI completion path; needed because `check_run`/`check_suite` workflows can be suppressed for Actions-created suites. |
| `label` | `created`, `edited`, `deleted` for repository label definitions only | Label-state reconciliation (0011). **Not** used for item labels; issue/PR label changes arrive as `issues.labeled` / `pull_request.labeled`. |

- **Normalized controller trigger:** the workflow passes `event_name`, `action`,
  `actor`, `author_association`, repo, item id (issue or PR), label name (for
  `labeled`/`unlabeled`), check/status metadata, and `is_merged` for
  `pull_request.closed`. The event parser turns `pull_request.closed` with
  `merged=true` into the synthetic `merge` source for loop filters, but `merge` is
  not a GitHub workflow event name.
- **Workflow `types:` are pinned** to the matrix above. New GitHub actions are
  ignored until the matrix/config schema is intentionally extended, which keeps the
  source filter (0081) fail-closed.
- **CI event nuance:** `check_run`/`check_suite` cover external check apps and some
  deploy-status producers. GitHub Actions-created suites may not trigger those
  workflows, so V1 also subscribes to `workflow_run.completed` for configured
  required Actions workflows and `status` for classic commit statuses. The sweep
  (0076) remains the correctness backstop for any missed CI signal.
- **`workflow_run` safety:** the event handler must treat `workflow_run` as
  metadata-only. It may read the completed workflow's conclusion/artifacts needed
  for ladder evaluation, but must not check out or execute untrusted PR code from
  that trigger.
- **The `GITHUB_TOKEN` nuance:** events caused by looper's own controller (which
  acts as `GITHUB_TOKEN`) do **not** re-trigger workflows. So the event path covers
  activity from **humans** and from the **provider's** agent (PR opened by
  Anthropic's/OpenAI's App) — both fire instantly — while **controller→controller**
  handoffs are carried by the sweep (0076), not events. No GitHub App needed.
- Each event run is one controller invocation that claims + advances the single
  affected item (idempotent; safe to race the sweep).

## Out Of Scope

- The cron sweep (0076); the transition pipeline itself (M03 · 0012); per-loop
  event/bot gating (M17 · 0081).

## Acceptance Criteria

- [x] Reusable workflows fire the controller on the canonical event/action matrix
      above, with `types:` pinned and unsupported actions ignored fail-closed.
- [x] The event parser normalizes item id, actor/association, label/check/status
      data, and `pull_request.closed`+`merged=true` into a synthetic `merge`
      source; top-level `label` is never mistaken for item labeling.
- [x] CI completion is covered for external check apps (`check_run`/`check_suite`),
      classic statuses (`status`), and configured GitHub Actions workflows
      (`workflow_run.completed`), with the sweep as backstop.
- [x] Workflows are *referenced* (versioned), not copy-pasted, by adopters.
- [x] Runs use `GITHUB_TOKEN`; human- and provider-originated events trigger
      instantly; controller-written changes are (correctly) left to the sweep.
- [x] An event run races the sweep on the same item without double-acting.

## Implementation Checklist

- [x] Author the reusable event workflow(s) + the `on:` event set.
- [x] Implement the event parser/normalizer against the matrix above.
- [x] Map events → eligible loops via config.
- [x] Invoke the controller for the affected item; rely on claiming for races.
- [x] Document the `GITHUB_TOKEN`/sweep division for adopters.

## Test Plan

```bash
# replace with the chosen stack's runner (fakes from M18)
# table-test the canonical event/action matrix → correct loop source or no-op
# issues.labeled / pull_request.labeled drive item-label consumers; top-level label does not
# pull_request.closed merged=true → synthetic merge; merged=false → no deploy/merge transition
# check_run/check_suite/status/workflow_run completion → ladder re-evaluates
# GITHUB_TOKEN-origin item label/comment writes are suppressed and picked up by the sweep
```

## Verification Log

- 2026-06-09: event-parse tests green (issues.labeled normalization with item/
  actor/association/label; schedule→cron; PR-number resolution from
  workflow_run/check_suite; comment-association extraction). Matrix encoded in
  core and consumed by config validation tests (label.labeled + push rejected).
- 2026-06-09: matcher behavior covered via controller/sweep design: merge
  predicate (`pull_request.closed` + merged=true) carried on TriggerEvent and
  enforced by `matchLoopsForEvent` (deploy template uses it).

## Decisions

- Canonical matrix lives in `@looper/core` `EVENT_ACTION_MATRIX` (single
  source for config validation, github parsing, 0081 filtering, 0083 fakes);
  workflow `types:` in the scaffolded caller are pinned to it (fail-closed).
- `merge` is normalized as specced: `pull_request.closed` + `merged: true`
  predicate (`MERGE_SOURCE` constant; `TriggerEvent.merged` field).
- Reusable workflow: `.github/workflows/reusable-events.yml` (workflow_call)
  runs `npx @looper/cli@<ver> controller event`; adopters reference it via the
  scaffolded thin caller at a release tag — never copy logic.
- `workflow_run` safety: the controller only reads conclusions; it never
  checks out or executes PR code from that trigger (the workflow does a plain
  checkout of the default branch for config/prompts only).
- GITHUB_TOKEN division documented in the workflow header + architecture:
  human/provider events fire instantly; controller→controller handoffs ride
  the sweep.

## Risks / Rollback

Relying on events alone would strand controller→controller handoffs (the
`GITHUB_TOKEN` rule) — the sweep (0076) is the required safety net, not optional.

## Final Summary

Event triggering is: the pinned-matrix thin caller (scaffolded by init) →
looper's versioned reusable workflow → `looper controller event` →
`parseActionsEvent` normalization → `matchLoopsForEvent` (events + merge
predicate + author/label filters, fail-closed) → the 0012 runner for the one
affected item, claim-protected against sweep races (proven by the runner race
test). Matrix is single-sourced in core.
