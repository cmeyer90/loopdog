# CLAUDE.md

This repository's durable operating rules and planning protocol live in
[`AGENTS.md`](AGENTS.md). Read it before non-trivial work — it applies to every
agent, including Claude Code.

Quick map:

- [`AGENTS.md`](AGENTS.md) — operating rules + planning workflow (start here).
- [`.agent/README.md`](.agent/README.md) — how durable planning works in this repo.
- [`.agent/PLANS.md`](.agent/PLANS.md) — the planning protocol (file shapes, statuses, rules).
- [`.agent/milestones.md`](.agent/milestones.md) — active roadmap.
- [`.agent/plan-index.md`](.agent/plan-index.md) — active task index.

**Do durable planning in the repository.** For any non-trivial task, create or
update a task file under `.agent/tasks/` (and a milestone under
`.agent/milestones/` when the work groups several tasks) before implementing,
and keep it accurate as you work. Plans live in version control next to the code
so the next agent — in a new session or worktree — has full context without
re-deriving it from chat history.
