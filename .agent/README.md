# Durable Planning

This directory is the repository's durable planning system. It exists so that
any agent — across sessions, worktrees, and tools — can pick up work with full
context instead of re-deriving it from chat history. Plans live in the repo, in
version control, next to the code they describe.

## Read In This Order

1. `../AGENTS.md` — operating rules and the planning workflow.
2. `PLANS.md` — the planning protocol: file shapes, status values, and rules.
3. This file — the layout, the lifecycle, and a worked example.

## Layout

```text
.agent/
  README.md             <- you are here
  PLANS.md              <- the planning protocol (rules of the road)
  task-template.md      <- copy to start a task
  milestone-template.md <- copy to start a milestone
  milestones.md         <- active roadmap index (milestones + task map)
  plan-index.md         <- active task index (flat, grep-friendly)
  milestones/           <- one file per active milestone
  tasks/                <- one file per active task
  archive/              <- completed / abandoned plans, kept for audit
    README.md
    plan-index.md       <- archived task index
    milestones.md       <- archived milestone index
    milestones/
    tasks/
```

## Concepts

- **Milestone** — a durable, outcome-shaped goal that groups related tasks
  (`milestones/milestone-NN-slug.md`). Holds the objective, guiding decisions,
  the planned-task table, the definition of done, and a verification log.
- **Task** — one reviewable slice of a milestone, ideally one branch and one PR
  (`tasks/NNNN-slug.md`). Holds goal, background, scope, acceptance criteria, an
  implementation checklist, a test plan, a verification log, decisions, and
  risks/rollback.
- **Indexes** — `milestones.md` and `plan-index.md` are the grep-friendly tables
  of record. Every milestone/task appears in its index. Update the index in the
  same change that creates or re-statuses a file.

## IDs

- Task ids are global, zero-padded to four digits, and only increase: `0001`,
  `0002`, … To allocate the next one, take the highest id across both
  `plan-index.md` and `archive/plan-index.md` and add one.
- Milestone numbers increment per milestone: `milestone-01-...`,
  `milestone-02-...`.
- Ids are never reused, even after a task is abandoned or archived.

## Lifecycle

1. **Open** — copy `task-template.md` to `tasks/NNNN-slug.md`, fill goal / scope
   / acceptance criteria, and add a row to `plan-index.md`. If the work groups
   several tasks, open a milestone too and list the task in its planned-task
   table.
2. **Work** — keep the task file accurate: tick the checklist, append dated
   verification-log entries, and record decisions as you make them.
3. **Finish** — run the checks, set status to `verified` (then `merged` once it
   lands), and update the milestone and `plan-index.md` in the same change.
4. **Archive** — when a milestone is fully done (or a task is abandoned), move
   the file under `archive/` and update both the active and archived indexes.
   See `archive/README.md`.

A milestone's **Planned Tasks** table is the authoritative forward breakdown of
that body of work, with reserved ids. A backlog task may live only as a `planned`
row in its milestone table; it gets its own task file and a `plan-index.md` row
when it moves to `ready` (i.e. someone or some loop picks it up). This keeps the
flat index focused on live work while milestones hold the roadmap.

## Statuses

`planned` → `ready` → `in-progress` → `implemented` → `verified` → `merged`.
`blocked` and `abandoned` are off-ramps. Full definitions are in `PLANS.md`.

## Worked Example

A small milestone with one task.

`milestones/milestone-01-cli-skeleton.md`:

```markdown
# Milestone 01: CLI Skeleton

Status: in-progress

## Objective

Stand up a runnable command-line entry point with config loading and a help
command, so later features have a place to plug in.

## Guiding Decisions

- One binary, subcommand-based.
- Config is read once at startup and passed down explicitly.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0001 | in-progress | task/0001-cli-config-loader | CLI Config Loader | Load and validate config at startup. |

## Definition Of Done

- `app --help` lists available subcommands.
- Config loads from a file and from environment overrides.
- Tests cover config precedence.

## Verification Log

- (add dated entries as tasks land)
```

`tasks/0001-cli-config-loader.md` is `task-template.md` filled in. Its row in
`plan-index.md`:

```text
| 0001 | in-progress | task/0001-cli-config-loader | CLI Config Loader |
```

That is the whole system: copy a template, fill it in, index it, keep it honest.
