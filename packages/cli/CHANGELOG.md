# @loopdog/cli

## 0.6.2

### Patch Changes

- [#25](https://github.com/cmeyer90/loopdog/pull/25) [`aa43925`](https://github.com/cmeyer90/loopdog/commit/aa43925cfc41e7a43e6a950ed1ccb61d5b73f8d7) Thanks [@Pugsin](https://github.com/Pugsin)! - Generate declaration files during the CLI bundle so the published `types` field and root export point to an included `dist/index.d.ts` file.

- [#23](https://github.com/cmeyer90/loopdog/pull/23) [`68c5eb0`](https://github.com/cmeyer90/loopdog/commit/68c5eb0d3a75889f274a83e0b7976cfe6ec3852d) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Wire the optional `LOOPDOG_PAT` through the reusable + scaffolded workflows so
  loop→loop handoffs can fire instantly (task 0105). The controller acts as the
  Actions `GITHUB_TOKEN`, whose label writes don't re-trigger workflows, so every
  controller→controller handoff (e.g. `ready-for-agent → implement`) waited on the
  `*/5` cron sweep — which GitHub throttles to many minutes or hours, stalling the
  pipeline. The identity layer already supported a PAT (`reTriggersWorkflows: true`)
  and the docs already promised it; the reusable/event/sweep workflows just never
  plumbed it. Now `reusable-events.yml`/`reusable-sweep.yml` accept an optional
  `loopdog_pat` secret and export it as `LOOPDOG_PAT`, and the scaffolded callers
  forward `${{ secrets.LOOPDOG_PAT }}`. New `loopdog connect cascade` stores the
  secret. Opt-in and fully backwards-compatible: with no PAT set, behavior is
  unchanged (GITHUB_TOKEN + sweep). Existing adopters: re-run `loopdog init` (or add
  the one `loopdog_pat:` line) and run `loopdog connect cascade`.

## 0.6.1

### Patch Changes

- [#20](https://github.com/cmeyer90/loopdog/pull/20) [`65ffaa1`](https://github.com/cmeyer90/loopdog/commit/65ffaa1458ee980042531ffd9539d0c2fbcfbb52) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Surface the running Claude work cell at dispatch. The dispatch marker comment now
  shows a `🔭 live session:` link, and `loopdog controller event`/`sweep` output
  appends the session per processed item. Setting `LOOPDOG_DEBUG` traces the routine
  `/fire` round-trip (request + response, session id/URL) to stderr for diagnosis —
  off by default, and the bearer token is never logged.

- [#20](https://github.com/cmeyer90/loopdog/pull/20) [`65ffaa1`](https://github.com/cmeyer90/loopdog/commit/65ffaa1458ee980042531ffd9539d0c2fbcfbb52) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Fix `loopdog upgrade` / `loopdog status` crashing with `Cannot find module
'../../package.json'`. The CLI version is now read from a single bundle-safe
  module (`src/version.ts`), so the flattened publish bundle resolves it relative to
  the installed package instead of one level above it.

## 0.6.0

### Minor Changes

- [#17](https://github.com/cmeyer90/loopdog/pull/17) [`46742b3`](https://github.com/cmeyer90/loopdog/commit/46742b39a9148df8cc02ef16707ffce4decdc32c) Thanks [@cmeyer90](https://github.com/cmeyer90)! - `loopdog status` now flags controller-version drift, so updating the CLI no
  longer leaves a stale controller running silently. When the `@loopdog/cli`
  version your caller workflows pin (`loopdog-version`) is an exact version older
  than the CLI you have installed, status shows a one-line nudge —
  `⚠ controller pinned v0.2.0 · CLI v0.4.0 — run loopdog upgrade to re-sync` — and
  the `--json` output gains a `controller` field. Floating pins (which auto-track)
  and current pins render nothing; the check is read locally and best-effort, so it
  works even when the live GitHub fetch is unavailable. Pairs with `loopdog
upgrade` re-syncing the pins: status tells you when, upgrade does it.

## 0.5.0

### Minor Changes

- [#16](https://github.com/cmeyer90/loopdog/pull/16) [`abf7954`](https://github.com/cmeyer90/loopdog/commit/abf79546327b8ee2664746d2838a5293d4934d29) Thanks [@cmeyer90](https://github.com/cmeyer90)! - `loopdog upgrade` now also re-syncs the scaffolded controller workflows' version
  pins, so an attached repo stops silently running a stale (and possibly buggy)
  controller after a Loopdog release.

  loopdog is zero-infra and can't push updates into an adopter repo, so a caller
  workflow only stays current if it **floats** on the major tag the release
  pipeline keeps moving (`uses: …/reusable-*.yml@vN`, `loopdog-version: 'N'`). New
  installs already float. But repos scaffolded by an older Loopdog carry **exact**
  pins (`@<sha>` / `0.x.y`) that never move, and nothing re-synced them — `upgrade`
  only touched the `.loopdog/` config tree and `init` won't overwrite existing
  workflow files.

  `upgrade` now rewrites `.github/workflows/loopdog-*.yml` to the floating major
  (owner/repo, secrets, and trailing comments preserved; non-loopdog workflows and
  the custom deploy workflow untouched). It runs **even when the config is already
  current** — pin drift is independent of the config `version` — and honors
  `--dry-run`. One upgrade converts a legacy exact-pinned install to auto-tracking.

## 0.4.0

### Minor Changes

- [#14](https://github.com/cmeyer90/loopdog/pull/14) [`080e520`](https://github.com/cmeyer90/loopdog/commit/080e520e5cbce682cb448b060c01fd13a7f224c0) Thanks [@cmeyer90](https://github.com/cmeyer90)! - Add `loopdog workflows` to manage the GitHub Actions workflows that drive the
  controller, so a disabled `loopdog-events`/`loopdog-sweep` no longer silently
  stalls the pipeline with no obvious cause.

  - `loopdog workflows` (alias `wf`) lists loopdog's workflows and whether each is
    enabled (`--all` to include the repo's own workflows, `--json` for machine
    output).
  - `loopdog workflows enable [names…]` / `disable [names…]` flip them on/off.
    With no names it targets only loopdog-owned workflows (your `ci` is never
    touched unless named); names accept `events`, `loopdog-events`, or
    `loopdog-events.yml`. Idempotent.
  - `loopdog init` now best-effort re-enables already-registered loopdog workflows
    on attach and points at `loopdog workflows` in its next steps. Safe-by-default
    means dry-run loops, not a switched-off controller.

  Implemented as a new `WorkflowsPort` capability on the GitHub port
  (`listWorkflows`/`enableWorkflow`/`disableWorkflow`) in both the Octokit and
  in-memory ports. Enable/disable use the operator's `gh`/token (needs
  `actions:write`), never the runtime `GITHUB_TOKEN`.

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
