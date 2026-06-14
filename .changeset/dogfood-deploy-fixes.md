---
'@loopdog/cli': patch
---

Fix the zero-infra Actions install path, surfaced by an end-to-end dogfood:

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
- **`loopdog init` pins the scaffolded workflows** to the installed CLI version
  (the `@v<major>` reusable-workflow ref + exact `loopdog-version`) instead of a
  nonexistent `@v0.1.0` tag.
- **Comment/plan-update results now ingest on the subscription path.** A Claude
  routine posts as the *user*, not a bot, so the old correlation (which required
  a `Bot` author) never matched groom/review results and they timed out. Ingest
  is now author-agnostic and keys on the `loopdog-verdict:` line (the dispatch
  marker, which also carries the run trailer, is no longer mistaken for the
  result). The brief now also tells the work cell to trail its summary comment.
- **The Claude `/fire` backend maps known errors to fixes** —
  `github_repo_access_denied`, `authentication_error`, and 429 now produce a
  one-line actionable message instead of a bare HTTP status.
- **`init` and `config validate` align their tables** to content width.
