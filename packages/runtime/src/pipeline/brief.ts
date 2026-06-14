import type { IssueSnapshot, LoopDefinition, WorkBrief } from '@loopdog/core';
import { CRITERIA_CLOSE, CRITERIA_OPEN } from '@loopdog/core';
import { compose } from '@loopdog/backends';
import type { ComposeContext, PromptSource } from '@loopdog/backends';

/**
 * The runner's compose step (0012 → 0022): builds the ComposeContext and
 * delegates to the artifact composer in `@loopdog/backends`. Prompt text comes
 * from versioned repo files (or built-ins) — never from loopdog source.
 */
export interface BriefInputs {
  loop: LoopDefinition;
  item: IssueSnapshot;
  runId: string;
  source: PromptSource;
  defaultBranch?: string | undefined;
  testCmd?: string | undefined;
  /** Recent non-loopdog comments (clarification replies, review feedback). */
  comments?: ReadonlyArray<{ author: string; body: string }> | undefined;
}

export async function composeWorkBrief(inputs: BriefInputs): Promise<WorkBrief> {
  const { loop, item, runId } = inputs;
  const expectedBranch = `loopdog/${loop.name}/${item.ref.number}-${runId}`;
  const expectedTrailer = `loopdog-run: ${runId}`;

  const ctx: ComposeContext = {
    issue: { number: item.ref.number, title: item.title, body: item.body },
    acceptanceCriteria: criteriaBlockText(item.body),
    transition: loop.transition,
    runId,
    loop: loop.name,
    backend: loop.backend,
    branch: expectedBranch,
    repo: { defaultBranch: inputs.defaultBranch ?? 'main' },
    adapter: { testCmd: inputs.testCmd },
    discussion:
      inputs.comments && inputs.comments.length > 0
        ? inputs.comments.map((c) => `@${c.author}: ${c.body}`).join('\n\n')
        : undefined,
  };
  const brief = await compose(ctx, inputs.source);

  return {
    runId,
    loop: loop.name,
    item: item.ref,
    briefRef: brief.ref,
    instructions: brief.text,
    expectedBranch,
    expectedTrailer,
    expectation: loop.expects ?? 'comment',
  };
}

/** A PromptSource over a single read function (tests / simple callers). */
export function promptSourceFromReader(
  read: (loop: LoopDefinition) => Promise<string>,
  loop: LoopDefinition,
): PromptSource {
  return {
    builtin: async () => null,
    repo: async () => read(loop).catch(() => null),
    overlay: async () => null,
    policy: async () => null,
  };
}

function criteriaBlockText(body: string): string {
  const start = body.indexOf(CRITERIA_OPEN);
  const end = body.indexOf(CRITERIA_CLOSE);
  if (start === -1 || end === -1 || end < start) return '';
  return body.slice(start, end + CRITERIA_CLOSE.length);
}
