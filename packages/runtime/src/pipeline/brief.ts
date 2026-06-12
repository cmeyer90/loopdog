import type { IssueSnapshot, LoopDefinition, WorkBrief } from '@looper/core';

/**
 * Composes the work brief the controller dispatches (0012/0022). The prompt
 * artifact text is injected (read from the checked-out repo by the caller);
 * the composer adds item context and the correlation contract. Versioning:
 * `briefRef` carries `<loop>/prompt.md@<sha8>` where sha8 is a content hash,
 * so a run record pins exactly which prompt drove it.
 */
export interface BriefInputs {
  loop: LoopDefinition;
  item: IssueSnapshot;
  runId: string;
  promptText: string;
}

export function composeBrief(inputs: BriefInputs): WorkBrief {
  const { loop, item, runId, promptText } = inputs;
  const expectedBranch = `looper/${loop.name}/${item.ref.number}-${runId}`;
  const expectedTrailer = `looper-run: ${runId}`;

  const instructions = [
    promptText.trim(),
    '',
    '---',
    '',
    `## Item ${item.ref.owner}/${item.ref.repo}#${item.ref.number}: ${item.title}`,
    '',
    item.body.trim(),
    '',
    '---',
    '',
    '## Looper contract (required)',
    '',
    `- Work on a NEW branch named exactly: \`${expectedBranch}\``,
    `- If you open a pull request, its body MUST end with the exact trailer line:`,
    '',
    `  ${expectedTrailer}`,
    '',
    `- Stay within the declared scope. If the work exceeds it, STOP and explain in a comment instead.`,
  ].join('\n');

  return {
    runId,
    loop: loop.name,
    item: item.ref,
    briefRef: `${loop.name}/prompt.md@${contentSha8(promptText)}`,
    instructions,
    expectedBranch,
    expectedTrailer,
    expectation: loop.expects ?? 'comment',
  };
}

/** 8-hex content hash (FNV-1a) for prompt artifact versioning. */
export function contentSha8(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
