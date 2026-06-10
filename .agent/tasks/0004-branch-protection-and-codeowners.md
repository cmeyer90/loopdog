# 0004 Branch Protection & CODEOWNERS

Status: implemented  
Branch: claude/laughing-johnson-8a7944

## Goal

Make looper's own `main` branch trustworthy: require the CI checks (0003) and a
review to merge, and put a human gate (via `CODEOWNERS`) on the workflow and
identity paths an autonomous loop must never be able to edit away — so looper is
itself built to the verification-ladder standard it enforces on adopters.

## Background

Part of
[Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md)
(its Definition of Done: "branch protection requires checks + review; CODEOWNERS
gates looper's own workflow/identity files"). This is rung 2 of the verification
ladder applied to looper itself — "**CI the agent cannot edit away** — the
adopter's required checks + branch protection + CODEOWNERS" (see
[architecture](../../docs/architecture.md), "The verification ladder"). It builds
directly on the CI pipeline (0003), which defines the `lint` / `test` / `build`
check jobs run on every `pull_request`. It is also dogfooding: when looper later
dispatches cloud agents against *this* repo, these are the exact rules that keep a
self-merging lineage from rubber-stamping its own work (architecture, "graduated
autonomy": keep `tier:core` human-gated via CODEOWNERS forever).

## Scope

- A `.github/CODEOWNERS` file owning the high-blast-radius paths with a human team,
  so changes there require an explicit owner review regardless of any auto-merge.
- Branch-protection configuration on `main` requiring the 0003 status checks + at
  least one approving review + CODEOWNER review on owned paths.
- The config captured **as code in the repo** (an `apply` script/workflow) so it is
  reviewable, reproducible, and not lost as click-ops in the GitHub UI.
- A documented bootstrap path (token/permission needs) recorded in `AGENTS.md`.

### Technical detail

This task touches **no `@looper/*` package** — it is repo-governance config under
`.github/` plus a small idempotent apply script. Keep it out of the published
packages.

**`.github/CODEOWNERS`** — own the paths an autonomous loop must never silently
change. Last-match-wins, so order specific rules after the catch-all:

```
# Default: any maintainer review satisfies (no forced owner)
*                                   @looper-org/maintainers

# Identity & gates the agent must not edit away (rung 2 of the ladder)
/.github/workflows/                 @looper-org/maintainers
/.github/CODEOWNERS                 @looper-org/maintainers
/.github/branch-protection.yml      @looper-org/maintainers
/templates/workflows/              @looper-org/maintainers   # reusable callers looper ships
/packages/github/src/identity/      @looper-org/maintainers   # GITHUB_TOKEN identity
/packages/runtime/src/loops-builtin/ @looper-org/maintainers  # built-in loop briefs/gates
/AGENTS.md                          @looper-org/maintainers
/.agent/                            @looper-org/maintainers   # durable plans/protocol
```

(The owning team is a placeholder; record the real handle in Decisions. Use a team
slug, not an individual, so reviews don't bus-factor on one person.)

**Branch protection** on `main`, expressed declaratively in
`.github/branch-protection.yml` and applied by a script (no hidden UI state):

```yaml
# .github/branch-protection.yml — source of truth, applied idempotently
branch: main
required_status_checks:
  strict: true                 # branch must be up to date before merge
  contexts: [lint, test, build]  # the job names from 0003's ci.yml
required_pull_request_reviews:
  required_approving_review_count: 1
  require_code_owner_reviews: true     # CODEOWNERS paths need owner sign-off
  dismiss_stale_reviews: true
enforce_admins: true            # rules apply to admins too — no bypass
required_linear_history: true
allow_force_pushes: false
allow_deletions: false
required_conversation_resolution: true
```

**Apply mechanism.** Provide `scripts/apply-branch-protection.ts` (run via the
repo's task runner, e.g. `npm run protect`) that reads `branch-protection.yml`,
`zod`-validates it, and PUTs it via Octokit
(`repos.updateBranchProtection`). It is **idempotent** (re-running yields no diff)
and read-back-verifies the live config matches the file, exiting non-zero on
drift. Optionally wire it into a manually-triggered `workflow_dispatch` job
(`.github/workflows/protect.yml`) so it can run from Actions. Reuse `zod` and the
Octokit dependency already introduced in 0001/0003; do not add new runtime deps.

**Identity/permission constraints (consistency).** Editing branch-protection and
reading org teams needs **`administration: write`** on the repo, which the default
Actions `GITHUB_TOKEN` does **not** have — so the apply step runs with a
**maintainer-provided admin PAT** in a repo secret (e.g. `ADMIN_TOKEN`) at
bootstrap, or is run locally by a maintainer via the CLI's existing `gh`/git auth.
This is a **one-time/occasional governance action by a human**, *not* part of the
controller's primary path — it does not reintroduce a looper GitHub App and does
not put keys on the model path. Document this plainly in `AGENTS.md`. The
controller's normal label/PR/claim writes (M03 · 0013, github package) still use
the keyless `GITHUB_TOKEN`.

**Edge cases:** the protection apply runs only on the default branch and is safe to
re-run; a missing/renamed CI context must fail the read-back check (catches a
silently-dropped required check — the exact failure mode rung 2 defends against);
private-repo CODEOWNERS teams must have repo access or GitHub silently ignores the
rule (verify on apply). Branch protection on a brand-new repo with zero commits is
a no-op until `main` exists — guard for that.

## Out Of Scope

- The CI workflow itself (0003) — this only *requires* its checks.
- Release/publish protections and tag protection (0005).
- The adopter-facing branch-protection that loops set on *target* repos and the
  risk-tier graduated auto-merge engine (M10) — this task is looper's own repo only.
- A looper GitHub App or any new bot identity (post-V1 per architecture).

## Acceptance Criteria

- [x] `.github/CODEOWNERS` exists and assigns a human owner to the workflow,
      identity (`packages/github/src/identity/`), built-in-loop, `AGENTS.md`, and
      `.agent/` paths.
- [ ] **OPERATOR:** `main` requires the `lint`, `test`, and `build` checks (from
      0003) to pass before merge. (Config + apply script ready; live apply is
      deliberately deferred — see Decisions: applying now would lock out a
      solo-maintainer repo.)
- [ ] **OPERATOR:** `main` requires ≥1 approving review and a CODEOWNER review on
      owned paths. (Same deferral.)
- [x] `enforce_admins`, no force-push, no deletion, and linear history are on —
      in the declared config (`.github/branch-protection.yml`).
- [x] Branch protection is captured as code (`.github/branch-protection.yml`) and
      applied by an idempotent, drift-detecting script — not click-ops only.
- [x] The token/permission needs to apply protection are documented in `AGENTS.md`.
- [x] Relevant checks pass (governance unit tests in `scripts/test/`).

## Implementation Checklist

- [x] Add `.github/CODEOWNERS` with the catch-all + owned high-blast-radius paths.
- [x] Add `.github/branch-protection.yml` as the declarative source of truth.
- [x] Add `scripts/apply-branch-protection.mjs` (zod-validate → PUT → read-back
      verify, idempotent, plus a `--check` verify-only mode and a ci.yml
      context-existence lockout guard) and the `npm run protect` script.
- [x] Add `.github/workflows/protect.yml` (`workflow_dispatch`) to run it.
- [ ] **OPERATOR:** Apply protection to `main` and confirm a PR cannot merge with
      a failing/missing required check or without the required review.
- [x] Document the admin-token bootstrap + apply command in `AGENTS.md`.

## Test Plan

Tests run via the repo's `vitest` runner (per 0001/0003). This is config, so the
core check is a unit-tested validator/diff plus a manual GitHub verification — no
real subscription quota is involved (no backend dispatch here).

```bash
# unit: branch-protection.yml parses + zod-validates; CODEOWNERS covers each
#       required owned path (a fixture-driven assertion, offline)
npm run test --workspace-root -- branch-protection
# apply (maintainer, with ADMIN_TOKEN) then verify idempotent + drift-detecting:
npm run protect            # applies
npm run protect            # re-run → reports "no changes" / exits 0
# manual on a scratch PR: red CI or no review ⇒ merge blocked; CODEOWNERS path
#   edit ⇒ owner review demanded
```

## Verification Log

- 2026-06-09: `npm test` — governance tests green: branch-protection.yml parses
  and declares the documented rules; every required context exists as a ci.yml
  job (lockout guard); CODEOWNERS covers each required owned path.
- 2026-06-09: live apply NOT run (deliberate; see Decisions). The script's
  context-vs-ci.yml guard runs at apply time as designed.

## Decisions

- CODEOWNERS owner: `@cmeyer90` (repo is user-owned; GitHub teams need an org).
  Replace with a `@<org>/maintainers` team slug when/if the repo moves to an
  org — owning via a team, not an individual, remains the goal.
- Apply path: both supported — local `npm run protect` (uses `ADMIN_TOKEN` /
  `GITHUB_TOKEN` env or `gh auth token`) and the `protect` workflow_dispatch
  job (uses the `ADMIN_TOKEN` repo secret).
- Required-check contexts: `lint`, `test`, `build` — exactly 0003's job names;
  both files carry sync comments and the unit test + apply-time guard enforce
  existence.
- **Live apply deferred to the operator, deliberately.** As declared
  (`enforce_admins: true`, `required_approving_review_count: 1`), protection on
  a repo with a single human (PR authors cannot approve their own PRs) makes
  `main` unmergeable by anyone — including the owner. Apply once a second
  maintainer/team exists, or first relax `enforce_admins`/review count
  consciously. The config-as-code + drift check make either choice reviewable.

## Risks / Rollback

- **Lockout / bootstrap:** turning on `enforce_admins` with a wrong/missing
  required-check name can block *all* merges (including the fix). Mitigate by
  validating context names against 0003 before apply and keeping the apply script
  re-runnable; rollback is removing the contexts via the same script (a maintainer
  with the admin token), or temporarily relaxing `branch-protection.yml` and
  re-applying.
- **Drift:** someone edits protection in the UI. The read-back verify surfaces drift
  on the next apply; treat the file as the source of truth.
- **Stale ownership:** an unmaintained CODEOWNERS team stalls every PR. Use an
  active team handle; review ownership when the package layout changes.

## Final Summary

Rung 2 of the verification ladder, as code: CODEOWNERS over the
workflow/identity/loop/plan paths, a declarative `.github/branch-protection.yml`
(checks + review + code-owner review + enforce_admins + linear history, no
force-push/delete), an idempotent zod-validated apply script with read-back
drift detection and a ci.yml-context lockout guard, a manual `protect`
workflow, unit tests over all of it, and documented token needs. Live
application is an operator action and is deliberately deferred with the
solo-maintainer lockout rationale recorded.
