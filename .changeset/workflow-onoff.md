---
'@loopdog/cli': minor
---

Add `loopdog workflows` to manage the GitHub Actions workflows that drive the
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
