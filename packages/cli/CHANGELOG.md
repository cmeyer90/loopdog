# @loopdog/cli

## 0.3.2

### Patch Changes

- [#12](https://github.com/cmeyer90/loopdog/pull/12) [`b5dc48e`](https://github.com/cmeyer90/loopdog/commit/b5dc48e9f33bf9aa090be6f8782819d7c957ce8e) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Fix plan-store fragmentation surfaced by an end-to-end dogfood — one issue must
  yield exactly one durable plan, bound to the source issue:

  - **Idempotent plan creation per issue.** `bindIssue` now scans the `Issue:`
    field for an existing plan before minting a new task id, so concurrent triage
    triggers reuse the one plan instead of racing to create duplicate stubs. The
    scan is shared with `resolveBinding` and matches `#N` exactly, so `#2` no
    longer collides with `#20`.
  - **Implement/review reuse the issue's plan, never a PR-bound one.**
    `syncPlanAfterTransition` resolves a pull-request item back to its linked
    source issue, so review/merge loops update the issue's plan (its `Issue:`
    field stays the source issue) instead of minting a plan numbered after the PR.
    A PR with no linked issue is skipped rather than misbound.
  - **Groomed criteria _and_ scope propagate into the durable plan.** Scope now
    carries from the issue body (loopdog's canonical source) into the plan via the
    new `parseScopeBlock`, joining the acceptance criteria that already did — so
    the loops that read the plan see the same acceptance bar humans groomed on the
    issue.

## 0.3.1

### Patch Changes

- [#8](https://github.com/cmeyer90/loopdog/pull/8) [`a7a012e`](https://github.com/cmeyer90/loopdog/commit/a7a012e0ea77767f4f5bbf871a5c58de23683d8c) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Fix the zero-infra Actions install path, surfaced by an end-to-end dogfood:

  - **Claims no longer strand items.** Assigning the cosmetic "someone's on it"
    bot/agent is now best-effort — an Actions installation token can't assign
    agents, and that failure used to abort the claim between marker and lease,
    failing every `act`-mode transition (including deterministic triage).
  - **Caller workflows grant the permissions the reusable workflow needs**
    (`contents: write`, `checks: read`); under-granting caused a `startup_failure`.
  - **`workflow_call` secrets use valid underscore names** (`claude_fire_url`,
    `claude_fire_token`, `codex_mention_token`) — hyphenated secret names are
    rejected by GitHub and broke the caller at startup. The reusable event/sweep
    workflows now forward these to the controller as env so `act`-mode dispatch
    actually authenticates.
  - **Comment/plan-update results now ingest on the subscription path.** A Claude
    routine posts as the _user_, not a bot, so the old correlation (which required
    a `Bot` author) never matched groom/review results and they timed out. Ingest
    is now author-agnostic and keys on the `loopdog-verdict:` line (the dispatch
    marker, which also carries the run trailer, is no longer mistaken for the
    result). The brief now also tells the work cell to trail its summary comment.
  - **Review verdicts in a formal PR review now ingest.** A reviewer naturally
    submits a GitHub PR review (not an issue comment); correlation now also scans
    `listReviews` for the verdict, plumbing it through `IngestResult.verdict`.
  - **The Claude `/fire` backend maps known errors to fixes** —
    `github_repo_access_denied`, `authentication_error`, and 429 now produce a
    one-line actionable message instead of a bare HTTP status.
  - **`init` and `config validate` align their tables** to content width.
