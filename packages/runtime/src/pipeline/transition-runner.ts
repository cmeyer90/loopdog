import type {
  CorrelationSignal,
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  IssueSnapshot,
  ItemRef,
  LoopDefinition,
  PreflightCheck,
  RepoRef,
  RunRecord,
  RunStep,
  TransitionTable,
  TriggerEvent,
} from '@looper/core';
import {
  DOR_FAIL_ROUTE,
  decideTransition,
  deriveRunId,
  evaluateDor,
  standardChecks,
  stateLabel,
  stateOfLabels,
} from '@looper/core';
import { acquireClaim, releaseClaim } from '@looper/github';
import { composeBrief } from './brief.js';
import { bumpAttempts, clearAttempts, parseAttempts } from './attempts.js';
import {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './dispatch-marker.js';
import type { RunRecordStore } from '../telemetry/record-store.js';

/**
 * The stateless transition runner (task 0012): per invocation, select eligible
 * items, advance each by AT MOST one step, emit a run record, write back.
 * Crash-safe single-step design: `dispatch` persists a marker comment and
 * returns; a LATER invocation (event or sweep) ingests the result. Safe under
 * event and cron invocation concurrently (claims + idempotent decisions).
 */

export interface RunnerDeps {
  gh: GitHubPort;
  backends: ReadonlyMap<string, ExecutionBackend>;
  records: RunRecordStore;
  table: TransitionTable;
  /** Reads a loop's prompt artifact text (from the checked-out repo). */
  readPrompt: (loop: LoopDefinition) => Promise<string>;
  /**
   * Extra pre-flight checks composed in by cross-cutting concerns:
   * authorization (M17), budget/quota/kill-switch (M12), resilience (M19).
   */
  extraChecks?: (ctx: {
    loop: LoopDefinition;
    item: IssueSnapshot;
    trigger: TriggerEvent;
  }) => Promise<PreflightCheck[]>;
  botLogin?: string;
  now?: () => Date;
  /** Attempt ceiling before the basic needs-human escalation (M12 refines). */
  maxAttempts?: number;
  /** Invocation-unique nonce for the claim CAS (injectable for determinism). */
  claimNonce?: () => string;
}

export async function runLoopOnce(
  deps: RunnerDeps,
  loop: LoopDefinition,
  repo: RepoRef,
  trigger: TriggerEvent,
): Promise<RunRecord[]> {
  const items = await selectItems(deps, loop, repo, trigger);
  const records: RunRecord[] = [];
  for (const item of items) {
    const record = await processItem(deps, loop, item, trigger);
    if (record) {
      await deps.records.append(record);
      records.push(record);
    }
  }
  return records;
}

async function selectItems(
  deps: RunnerDeps,
  loop: LoopDefinition,
  repo: RepoRef,
  trigger: TriggerEvent,
): Promise<IssueSnapshot[]> {
  if (trigger.kind === 'event' && trigger.item) {
    return [await deps.gh.getIssue(trigger.item)];
  }
  // Cron sweep (or item-less event): scan the loop's from-state.
  return deps.gh.listIssuesByLabel(repo, stateLabel(loop.transition.from));
}

async function processItem(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  trigger: TriggerEvent,
): Promise<RunRecord | null> {
  const now = deps.now?.() ?? new Date();
  const steps: RunStep[] = [];
  const attempt = parseAttempts(item.labels) + 1;
  const runId = deriveRunId(loop.name, item.ref, attempt);
  const record = (outcome: RunRecord['outcome'], briefRef?: string): RunRecord => ({
    runId,
    loop: loop.name,
    item: item.ref,
    trigger:
      trigger.kind === 'event'
        ? { kind: 'event', event: trigger.name, at: now.toISOString() }
        : { kind: 'cron', at: now.toISOString() },
    backend: loop.backend,
    briefRef,
    steps,
    outcome,
    cost: loop.expects ? { routineRuns: loop.backend === 'claude' ? 1 : 0 } : {},
  });

  // Ingest phase first: a pending dispatch on this item takes precedence over
  // dispatching again — this is what makes re-invocation idempotent.
  const pending = findPendingDispatches(await deps.gh.listComments(item.ref));
  const ours = pending.filter((p) => p.handle.runId.startsWith(`run-${loop.name}-`));
  if (ours.length > 0) {
    return ingestPhase(deps, loop, item, ours[0]!, steps, record, now);
  }

  // Decision: standard state-machine checks + gate + cross-cutting extras.
  const checks = standardChecks(loop, deps.table, item, now);
  if (loop.gates.requireDor && loop.expects === 'pull-request') {
    const dor = evaluateDor(item.body);
    checks.push({
      name: 'dor-gate',
      verdict: dor.pass
        ? { kind: 'proceed' }
        : { kind: 'route', to: DOR_FAIL_ROUTE, reason: dor.reasons.join('; ') },
    });
  }
  if (deps.extraChecks) {
    checks.push(...(await deps.extraChecks({ loop, item, trigger })));
  }
  const decision = decideTransition(checks);
  steps.push({
    t: now.toISOString(),
    kind: 'gate',
    detail: `decision: ${decision.verdict.kind} (${decision.decidedBy})`,
  });

  switch (decision.verdict.kind) {
    case 'no-op':
    case 'skip':
      return null; // not an attempt — common on sweeps; no record spam
    case 'park': {
      if (loop.mode === 'act') {
        await deps.gh.addLabels(item.ref, ['looper:parked']);
        await comment(deps, item.ref, `⏸️ looper parked this item: ${decision.verdict.reason}`);
      }
      return record({ status: 'parked' });
    }
    case 'route': {
      const to = decision.verdict.to;
      if (loop.mode === 'act') {
        await applyStateChange(deps, item, to);
        await comment(
          deps,
          item.ref,
          `↩️ looper routed this item to \`${to}\`: ${decision.verdict.reason}`,
        );
      }
      steps.push({ t: now.toISOString(), kind: 'write', detail: `routed to ${to}` });
      return record({ status: 'done', transition: `${loop.transition.from}->${to}` });
    }
    case 'escalate': {
      if (loop.mode === 'act') {
        await deps.gh.addLabels(item.ref, ['looper:needs-human']);
        await comment(deps, item.ref, `🚨 looper escalated: ${decision.verdict.reason}`);
      }
      return record({
        status: 'escalated',
        failure: { class: 'terminal', reason: decision.verdict.reason },
      });
    }
    case 'proceed':
      break;
  }

  // Dry-run: comment-only preview, no claim, no labels, no dispatch (0009).
  if (loop.mode === 'dry-run') {
    const preview = loop.expects
      ? `would claim, dispatch a ${loop.expects} work cell to **${loop.backend}**, and advance \`${loop.transition.from}\` → \`${loop.transition.to}\``
      : `would advance \`${loop.transition.from}\` → \`${loop.transition.to}\``;
    await upsertDryRunComment(
      deps,
      loop,
      item.ref,
      `🧪 looper dry-run (\`${loop.name}\`): ${preview}.`,
    );
    steps.push({ t: now.toISOString(), kind: 'write', detail: 'dry-run comment' });
    return record({
      status: 'done',
      transition: `dry-run:${loop.transition.from}->${loop.transition.to}`,
    });
  }

  // Claim (atomic; loser walks away cleanly). The claimant token is
  // invocation-unique — two invocations deriving the same runId must still
  // contend as two claimants (the event-vs-sweep double-dispatch defense).
  const nonce = deps.claimNonce?.() ?? Math.random().toString(36).slice(2, 8);
  const claim = await acquireClaim(deps.gh, item.ref, runId, {
    now,
    claimant: `${runId}~${nonce}`,
    ...(deps.botLogin ? { assignee: deps.botLogin } : {}),
    ...(loop.serializeBy ? { serializeArea: loop.serializeBy } : {}),
  });
  if (!claim.acquired) {
    steps.push({ t: now.toISOString(), kind: 'claim', detail: `not acquired: ${claim.reason}` });
    return null; // another runner owns it — not an attempt
  }
  steps.push({ t: now.toISOString(), kind: 'claim', detail: `lease until ${claim.leaseUntil}` });

  try {
    if (!loop.expects) {
      // Deterministic transition: apply and release in one invocation.
      await applyStateChange(deps, item, loop.transition.to);
      steps.push({ t: now.toISOString(), kind: 'write', detail: `state -> ${loop.transition.to}` });
      await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
      await clearAttempts(deps.gh, item.ref);
      return record({
        status: 'done',
        transition: `${loop.transition.from}->${loop.transition.to}`,
      });
    }

    // Work-cell transition: compose → dispatch → persist handle → (maybe) mark
    // the intermediate state. Ingest happens on a later invocation.
    const promptText = await deps.readPrompt(loop);
    const brief = composeBrief({ loop, item, runId, promptText });
    steps.push({ t: now.toISOString(), kind: 'compose', detail: brief.briefRef });

    const backend = deps.backends.get(loop.backend);
    if (!backend) throw new Error(`no backend registered for '${loop.backend}'`);
    const handle = await backend.dispatch(brief);
    steps.push({ t: now.toISOString(), kind: 'dispatch', detail: `signal: ${handle.signal.kind}` });

    await deps.gh.createComment(item.ref, renderDispatchMarker(handle));
    if (
      loop.transition.to !== 'in-progress' &&
      deps.table.edges.some((e) => e.from === loop.transition.from && e.to === 'in-progress')
    ) {
      await applyStateChange(deps, item, 'in-progress');
      steps.push({
        t: now.toISOString(),
        kind: 'write',
        detail: 'state -> in-progress (dispatched)',
      });
    }
    return record({ status: 'pending', artifacts: sessionArtifact(handle.signal) }, brief.briefRef);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    steps.push({ t: now.toISOString(), kind: 'dispatch', detail: `failed: ${reason}` });
    await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
    const attempts = await bumpAttempts(deps.gh, item.ref);
    if (attempts >= (deps.maxAttempts ?? 3)) {
      await deps.gh.addLabels(item.ref, ['looper:needs-human']);
      await comment(
        deps,
        item.ref,
        `🚨 looper: ${attempts} failed attempts — needs a human. Last error: ${reason}`,
      );
      return record({ status: 'escalated', failure: { class: 'poisoned', reason } });
    }
    return record({ status: 'failed', failure: { class: 'transient', reason } });
  }
}

async function ingestPhase(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  pending: { commentId: number; handle: DispatchHandle },
  steps: RunStep[],
  record: (outcome: RunRecord['outcome'], briefRef?: string) => RunRecord,
  now: Date,
): Promise<RunRecord | null> {
  const backend = deps.backends.get(pending.handle.backend);
  if (!backend) return null;
  const result = await backend.ingest(pending.handle);
  steps.push({ t: now.toISOString(), kind: 'ingest', detail: result.status });

  if (result.status === 'pending') return null; // check again next invocation

  const comments = await deps.gh.listComments(item.ref);
  const marker = comments.find((c) => c.id === pending.commentId);

  if (result.status === 'failed') {
    if (marker) {
      await deps.gh.updateComment(
        item.ref,
        pending.commentId,
        markDispatchResolved(marker.body, `failed: ${result.reason}`),
      );
    }
    await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
    const attempts = await bumpAttempts(deps.gh, item.ref);
    if (attempts >= (deps.maxAttempts ?? 3)) {
      await deps.gh.addLabels(item.ref, ['looper:needs-human']);
    }
    return record({
      status: 'failed',
      failure: { class: 'transient', reason: result.reason },
    });
  }

  // Completed: advance to the loop's target state, link artifacts, release.
  const note = result.pr
    ? `ingested PR #${result.pr.ref.number} (matched by ${result.matchedBy})`
    : `ingested result (matched by ${result.matchedBy})`;
  if (marker) {
    await deps.gh.updateComment(
      item.ref,
      pending.commentId,
      markDispatchResolved(marker.body, note),
    );
  }
  await applyStateChange(deps, item, loop.transition.to);
  if (result.pr) {
    await deps.gh.addLabels(result.pr.ref, [stateLabel(loop.transition.to)]);
  }
  steps.push({ t: now.toISOString(), kind: 'write', detail: `state -> ${loop.transition.to}` });
  await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
  await clearAttempts(deps.gh, item.ref);
  return record({
    status: 'done',
    transition: `${loop.transition.from}->${loop.transition.to}`,
    artifacts: {
      ...(result.pr ? { pr: result.pr.ref.number } : {}),
      ...sessionArtifact(pending.handle.signal),
    },
  });
}

async function applyStateChange(deps: RunnerDeps, item: IssueSnapshot, to: string): Promise<void> {
  const current = await deps.gh.getItemLabels(item.ref);
  const currentState = stateOfLabels(current);
  await deps.gh.addLabels(item.ref, [stateLabel(to)]);
  if (currentState && currentState !== to) {
    await deps.gh.removeLabel(item.ref, stateLabel(currentState));
  }
}

async function comment(deps: RunnerDeps, ref: ItemRef, body: string): Promise<void> {
  await deps.gh.createComment(ref, body);
}

/** One sticky dry-run comment per loop, updated in place (no sweep spam). */
async function upsertDryRunComment(
  deps: RunnerDeps,
  loop: LoopDefinition,
  ref: ItemRef,
  body: string,
): Promise<void> {
  const marker = `<!-- looper:dry-run:${loop.name} -->`;
  const full = `${body}\n\n${marker}`;
  const existing = (await deps.gh.listComments(ref)).find((c) => c.body.includes(marker));
  if (existing) {
    if (existing.body !== full) await deps.gh.updateComment(ref, existing.id, full);
  } else {
    await deps.gh.createComment(ref, full);
  }
}

function sessionArtifact(signal: CorrelationSignal): { session?: string } | undefined {
  if (signal.kind === 'claude-session') return { session: signal.sessionUrl ?? signal.sessionId };
  if (signal.kind === 'codex-mention') return { session: `comment:${signal.commentId}` };
  return undefined;
}
