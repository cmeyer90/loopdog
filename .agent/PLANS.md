# Planning Protocol

Each task and milestone plan is a living document. Keep it accurate as work
proceeds. For orientation and a worked example, read `README.md` first.

## Task File Naming

Use:

```text
NNNN-short-slug.md
```

Example:

```text
0007-add-usage-export.md
```

## Milestone File Naming

Use:

```text
milestone-NN-short-slug.md
```

Example:

```text
milestone-03-usage-reporting.md
```

## Required Task Sections

Each task file must contain:

- Status
- Branch
- Goal
- Background
- Scope
- Out of scope
- Acceptance criteria
- Implementation checklist
- Test plan
- Verification log
- Decisions
- Risks / rollback
- Final summary

Start from `task-template.md`.

## Required Milestone Sections

Each milestone file must contain:

- Status
- Objective
- Guiding decisions
- Planned tasks (table)
- Definition of done
- Verification log

Start from `milestone-template.md`.

## Status Values

Use one of:

- `planned` — written down, not started.
- `ready` — scoped and unblocked, safe to start.
- `in-progress` — actively being implemented.
- `blocked` — cannot proceed; record why and on what it depends.
- `implemented` — code is done, verification not yet complete.
- `verified` — implemented and verification has passed.
- `merged` — landed on the target branch.
- `abandoned` — dropped; record why. The id is retired, not reused.

## Branch Naming

Use:

```text
task/NNNN-short-slug
```

Example:

```text
task/0007-add-usage-export
```

## Bite-Sized Rule

A task should usually be small enough to implement in one branch and review in
one PR.

If a task needs multiple PRs, split it into child tasks under the same
milestone.

## Verification Log Rules

Add dated entries as work proceeds. Each entry should include:

- the command run,
- the result,
- relevant notes or the failure reason.

Example:

```text
2026-06-08: `npm test` - passed (42 passing).
2026-06-08: `npm run build` - failed; missing env var, documented in Risks.
```

## Completion Rules

When a task is complete:

- Set the task file `Status` to `verified` after implementation is done and
  verification has passed.
- Set the task file `Status` to `merged` after it lands on the target branch, if
  that state is known.
- Update the implementation checklist, verification log, decisions,
  risks/rollback, and final summary before reporting completion.
- Update any parent milestone with checked success criteria, verification
  commands/results, and merge or commit references when available.
- Update `plan-index.md` in the same change as the task status update.

## Plan Index Rules

Update `plan-index.md` whenever a task is added or its status changes. Update
`milestones.md` whenever a milestone is added or its status changes, and keep its
task-to-milestone map current.

Keep the indexes boring and grep-friendly.

## Archive Rules

Active task files live in `tasks/`; archived task files live in `archive/tasks/`.
Active milestone files live in `milestones/`; archived milestone files live in
`archive/milestones/`.

When a milestone is fully done or a task is abandoned, move the file to the
matching `archive/` directory and keep `archive/plan-index.md` and
`archive/milestones.md` current. Ids are not reused after archiving.
