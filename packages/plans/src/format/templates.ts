/**
 * The plan templates loopdog emits into adopter repos (task 0015) — exactly the
 * section set this repo's own `.agent/` protocol enforces, so the product and
 * the dogfood stay identical. Embedded as code so the bundled CLI carries them;
 * `packages/plans/templates/*.md` hold the same bytes (drift-guarded by test).
 */

export const TASK_TEMPLATE = `# {{id}} {{title}}

Status: {{status}}
Branch: {{branch}}
Issue: {{issue}}

## Goal

{{goal}}

## Background

{{background}}

## Scope

{{scope}}

## Out Of Scope

- (none recorded yet)

## Acceptance Criteria

{{criteria}}

## Implementation Checklist

- [ ] (filled in by the implementation work cell)

## Test Plan

{{testPlan}}

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record implementation decisions here, not only in chat.

## Risks / Rollback

Record risks and the rollback path before acting.

## Final Summary

Fill this in before marking verified.
`;

export const MILESTONE_TEMPLATE = `# Milestone {{id}}: {{title}}

Status: {{status}}

## Objective

{{objective}}

## Guiding Decisions

- (none recorded yet)

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|

## Definition Of Done

{{definitionOfDone}}

## Verification Log

Add dated entries as tasks land.
`;

export function renderTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? '');
}

/** Plan-store layout (task 0015) under the configurable root. */
export const STORE_LAYOUT = {
  tasks: 'tasks',
  milestones: 'milestones',
  archiveTasks: 'archive/tasks',
  archiveMilestones: 'archive/milestones',
  planIndex: 'plan-index.md',
  milestonesIndex: 'milestones.md',
  archivePlanIndex: 'archive/plan-index.md',
  archiveMilestonesIndex: 'archive/milestones.md',
} as const;

export const FORMAT_VERSION = 1;

export function assertSupportedFormatVersion(version: number): void {
  if (version > FORMAT_VERSION) {
    throw new Error(
      `plan store format_version ${version} is newer than this loopdog supports ` +
        `(${FORMAT_VERSION}) — upgrade loopdog before touching these plans`,
    );
  }
}
