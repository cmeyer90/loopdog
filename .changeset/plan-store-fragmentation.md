---
'@loopdog/cli': patch
---

Fix plan-store fragmentation surfaced by an end-to-end dogfood — one issue must
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
- **Groomed criteria *and* scope propagate into the durable plan.** Scope now
  carries from the issue body (loopdog's canonical source) into the plan via the
  new `parseScopeBlock`, joining the acceptance criteria that already did — so
  the loops that read the plan see the same acceptance bar humans groomed on the
  issue.
