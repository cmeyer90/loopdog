---
'@loopdog/cli': patch
---

Wire the optional `LOOPDOG_PAT` through the reusable + scaffolded workflows so
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
