import type { CommentSnapshot, DispatchHandle } from '@loopdog/core';

/**
 * The dispatch handle persists as a marker comment on the item, so a LATER
 * invocation (event or sweep) can ingest the result — the crash-safe boundary
 * of the single-step runner (0012). The dispatch-time correlation signal in
 * the handle is the authoritative key (0093 decision).
 */

const OPEN = '<!-- loopdog:dispatch ';
const CLOSE = ' -->';
const RESOLVED = '<!-- loopdog:dispatch-resolved -->';

export function renderDispatchMarker(handle: DispatchHandle): string {
  return [
    `🛰️ loopdog dispatched \`${handle.runId}\` to **${handle.backend}**`,
    '',
    `- expected branch: \`${handle.expectedBranch}\``,
    `- expected PR trailer: \`${handle.expectedTrailer}\``,
    `- dispatched at: ${handle.dispatchedAt}`,
    '',
    `${OPEN}${JSON.stringify(handle)}${CLOSE}`,
  ].join('\n');
}

export interface PendingDispatch {
  commentId: number;
  handle: DispatchHandle;
}

/** Unresolved dispatch markers on an item, oldest first. */
export function findPendingDispatches(comments: readonly CommentSnapshot[]): PendingDispatch[] {
  const pending: PendingDispatch[] = [];
  for (const comment of comments) {
    if (comment.body.includes(RESOLVED)) continue;
    const start = comment.body.indexOf(OPEN);
    if (start === -1) continue;
    const end = comment.body.indexOf(CLOSE, start);
    if (end === -1) continue;
    try {
      const handle = JSON.parse(comment.body.slice(start + OPEN.length, end)) as DispatchHandle;
      pending.push({ commentId: comment.id, handle });
    } catch {
      // malformed marker: ignore (fail closed — nothing to ingest from it)
    }
  }
  return pending;
}

export function markDispatchResolved(body: string, note: string): string {
  return `${body}\n\n${RESOLVED}\n✅ ${note}`;
}
