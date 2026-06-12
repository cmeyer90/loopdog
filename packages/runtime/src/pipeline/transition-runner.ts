import type {
  CorrelationSignal,
  DispatchHandle,
  ExecutionBackend,
  GitHubPort,
  IssueSnapshot,
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
import { acquireClaim, releaseClaim, upsertMarkedComment } from '@looper/github';
import type { PromptSource } from '@looper/backends';
import { composeWorkBrief, promptSourceFromReader } from './brief.js';
import { bumpAttempts, clearAttempts, parseAttempts } from './attempts.js';
import {
  findPendingDispatches,
  markDispatchResolved,
  renderDispatchMarker,
} from './dispatch-marker.js';
import { EffectGate } from './effect-gate.js';
import { syncPlanAfterTransition } from './plan-sync.js';
import type { RepoPlanStoreFiles } from '@looper/plans';
import type { RunRecordStore } from '../telemetry/record-store.js';

/**
 * The stateless transition runner (task 0012): per invocation, select eligible
 * items, advance each by AT MOST one step, emit a run record, write back.
 * Crash-safe single-step design: `dispatch` persists a marker comment and
 * returns; a LATER invocation (event or sweep) ingests the result. Safe under
 * event and cron invocation concurrently (claims + idempotent decisions).
 * Every outward effect flows through the mode `EffectGate` (task 0009) —
 * dry-run records intentions, suggest adds one advisory comment, act acts.
 */

export interface RunnerDeps {
  gh: GitHubPort;
  backends: ReadonlyMap<string, ExecutionBackend>;
  records: RunRecordStore;
  table: TransitionTable;
  /** Reads a loop's prompt artifact text (from the checked-out repo). */
  readPrompt: (loop: LoopDefinition) => Promise<string>;
  /** Full layered prompt source (0022); defaults to a readPrompt wrapper. */
  promptSource?: PromptSource;
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
  /** Forces dry-run for this invocation; can only tighten, never loosen (0009). */
  forceDryRun?: boolean;
  /** Durable plan store files (M04); absent = plan upkeep skipped. */
  planFiles?: RepoPlanStoreFiles;
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
    const record = await runLoopOnItem(deps, loop, item, trigger);
    if (record) records.push(record);
  }
  return records;
}

/** Process ONE item through one loop (the sweep drives candidates with this). */
export async function runLoopOnItem(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  trigger: TriggerEvent,
): Promise<RunRecord | null> {
  const record = await processItem(deps, loop, item, trigger);
  if (record) await deps.records.append(record);
  return record;
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
  // Cron sweep (or item-less event): scan every state this loop drives.
  const items: IssueSnapshot[] = [];
  for (const state of scanStates(loop, deps.table)) {
    items.push(...(await deps.gh.listIssuesByLabel(repo, stateLabel(state))));
  }
  return items;
}

/**
 * The states a loop's sweep scan covers: its from-state, plus the canonical
 * dispatched intermediate (`in-progress`) for work-cell loops that span it —
 * otherwise a dispatched item would be invisible to the sweep and stranded
 * until an event arrived (a real bug the plan-sync test caught).
 */
export function scanStates(loop: LoopDefinition, table: TransitionTable): string[] {
  const states = [loop.transition.from];
  if (
    loop.expects &&
    loop.transition.from !== 'in-progress' &&
    loop.transition.to !== 'in-progress' &&
    table.edges.some((e) => e.from === loop.transition.from && e.to === 'in-progress')
  ) {
    states.push('in-progress');
  }
  return states;
}

async function processItem(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  trigger: TriggerEvent,
): Promise<RunRecord | null> {
  const now = deps.now?.() ?? new Date();
  const steps: RunStep[] = [];
  const mode = deps.forceDryRun ? 'dry-run' : loop.mode;
  const gate = new EffectGate(mode);
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
    mode,
    planned: gate.planned,
    steps,
    outcome,
    cost:
      loop.expects && gate.policy.dispatch
        ? { routineRuns: loop.backend === 'claude' ? 1 : 0 }
        : {},
  });
  const step = (kind: RunStep['kind'], detail: string) =>
    steps.push({ t: now.toISOString(), kind, detail });

  // Ingest phase first: a pending dispatch on this item takes precedence over
  // dispatching again — this is what makes re-invocation idempotent.
  const pending = findPendingDispatches(await deps.gh.listComments(item.ref));
  const ours = pending.filter((p) => p.handle.runId.startsWith(`run-${loop.name}-`));
  if (ours.length > 0) {
    return ingestPhase(deps, loop, item, ours[0]!, gate, steps, step, record);
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
  step('gate', `decision: ${decision.verdict.kind} (${decision.decidedBy})`);

  switch (decision.verdict.kind) {
    case 'no-op':
    case 'skip':
      return null; // not an attempt — common on sweeps; no record spam
    case 'park': {
      const reason = decision.verdict.reason;
      await gate.mutate('label', `add looper:parked (${reason})`, () =>
        deps.gh.addLabels(item.ref, ['looper:parked']),
      );
      await gate.comment(`park notice`, () =>
        deps.gh.createComment(item.ref, `⏸️ looper parked this item: ${reason}`),
      );
      return record({ status: 'parked' });
    }
    case 'route': {
      const { to, reason } = decision.verdict;
      await gate.mutate('label', `state -> ${to} (${reason})`, () =>
        applyStateChange(deps, item, to),
      );
      await gate.comment('route notice', () =>
        deps.gh.createComment(item.ref, `↩️ looper routed this item to \`${to}\`: ${reason}`),
      );
      step('write', `routed to ${to}`);
      return record({ status: 'done', transition: `${loop.transition.from}->${to}` });
    }
    case 'escalate': {
      const reason = decision.verdict.reason;
      await gate.mutate('label', 'add looper:needs-human', () =>
        deps.gh.addLabels(item.ref, ['looper:needs-human']),
      );
      await gate.comment('escalation notice', () =>
        deps.gh.createComment(item.ref, `🚨 looper escalated: ${reason}`),
      );
      return record({ status: 'escalated', failure: { class: 'terminal', reason } });
    }
    case 'proceed':
      break;
  }

  // Claim (atomic; loser walks away cleanly). The claimant token is
  // invocation-unique — two invocations deriving the same runId must still
  // contend as two claimants (the event-vs-sweep double-dispatch defense).
  const nonce = deps.claimNonce?.() ?? Math.random().toString(36).slice(2, 8);
  const claim = await gate.mutate('claim', `claim ${runId}`, () =>
    acquireClaim(deps.gh, item.ref, runId, {
      now,
      claimant: `${runId}~${nonce}`,
      ...(deps.botLogin ? { assignee: deps.botLogin } : {}),
      ...(loop.serializeBy ? { serializeArea: loop.serializeBy } : {}),
    }),
  );
  if (claim && !claim.acquired) {
    step('claim', `not acquired: ${claim.reason}`);
    return null; // another runner owns it — not an attempt
  }
  if (claim) step('claim', `lease until ${claim.leaseUntil}`);

  try {
    if (!loop.expects) {
      // Deterministic transition: apply and release in one invocation.
      await gate.mutate('label', `state -> ${loop.transition.to}`, () =>
        applyStateChange(deps, item, loop.transition.to),
      );
      step('write', `state -> ${loop.transition.to}`);
      await gate.mutate('claim', 'release', async () => {
        await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
        await clearAttempts(deps.gh, item.ref);
      });
      const done = record({
        status: 'done',
        transition: `${loop.transition.from}->${loop.transition.to}`,
      });
      await syncPlanAfterTransition(
        deps.gh,
        deps.planFiles,
        gate,
        item,
        loop.transition.to,
        done,
        now,
      );
      await suggestAdvisory(
        deps,
        loop,
        item,
        gate,
        `advance \`${loop.transition.from}\` → \`${loop.transition.to}\``,
      );
      return done;
    }

    // Work-cell transition: compose → dispatch → persist handle → (maybe) mark
    // the intermediate state. Ingest happens on a later invocation.
    const source = deps.promptSource ?? promptSourceFromReader(deps.readPrompt, loop);
    const brief = await composeWorkBrief({ loop, item, runId, source });
    gate.note('compose', brief.briefRef);
    step('compose', brief.briefRef);

    const backend = deps.backends.get(loop.backend);
    if (!backend) throw new Error(`no backend registered for '${loop.backend}'`);
    const handle = await gate.dispatch(
      `${loop.expects} work cell to ${loop.backend} (brief ${brief.briefRef})`,
      () => backend.dispatch(brief),
    );
    if (handle) {
      step('dispatch', `signal: ${handle.signal.kind}`);
      await gate.mutate('comment', 'persist dispatch handle', () =>
        deps.gh.createComment(item.ref, renderDispatchMarker(handle)).then(() => {}),
      );
      if (
        loop.transition.to !== 'in-progress' &&
        deps.table.edges.some((e) => e.from === loop.transition.from && e.to === 'in-progress')
      ) {
        await gate.mutate('label', 'state -> in-progress (dispatched)', () =>
          applyStateChange(deps, item, 'in-progress'),
        );
        step('write', 'state -> in-progress (dispatched)');
      }
      const pendingRecord = record(
        { status: 'pending', artifacts: sessionArtifact(handle.signal) },
        brief.briefRef,
      );
      await syncPlanAfterTransition(
        deps.gh,
        deps.planFiles,
        gate,
        item,
        'in-progress',
        pendingRecord,
        now,
      );
      return pendingRecord;
    }
    // Dispatch blocked by mode: preview only.
    gate.note('plan', 'would bind issue to a durable plan and update it through the lifecycle');
    await suggestAdvisory(
      deps,
      loop,
      item,
      gate,
      `dispatch a ${loop.expects} work cell to **${loop.backend}** and advance ` +
        `\`${loop.transition.from}\` → \`${loop.transition.to}\``,
    );
    return record(
      { status: 'done', transition: `${mode}:${loop.transition.from}->${loop.transition.to}` },
      brief.briefRef,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    step('dispatch', `failed: ${reason}`);
    await gate.mutate('claim', 'release after failure', () =>
      releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
    );
    const attempts =
      (await gate.mutate('label', 'bump attempts', () => bumpAttempts(deps.gh, item.ref))) ??
      attempt;
    if (attempts >= (deps.maxAttempts ?? 3)) {
      await gate.mutate('label', 'add looper:needs-human', () =>
        deps.gh.addLabels(item.ref, ['looper:needs-human']),
      );
      await gate.comment('escalation notice', () =>
        deps.gh.createComment(
          item.ref,
          `🚨 looper: ${attempts} failed attempts — needs a human. Last error: ${reason}`,
        ),
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
  gate: EffectGate,
  steps: RunStep[],
  step: (kind: RunStep['kind'], detail: string) => void,
  record: (outcome: RunRecord['outcome'], briefRef?: string) => RunRecord,
): Promise<RunRecord | null> {
  void steps;
  const backend = deps.backends.get(pending.handle.backend);
  if (!backend) return null;
  const result = await backend.ingest(pending.handle);
  step('ingest', result.status);

  if (result.status === 'pending') return null; // check again next invocation

  const comments = await deps.gh.listComments(item.ref);
  const marker = comments.find((c) => c.id === pending.commentId);

  if (result.status === 'failed') {
    if (marker) {
      await gate.mutate('comment', 'mark dispatch failed', () =>
        deps.gh.updateComment(
          item.ref,
          pending.commentId,
          markDispatchResolved(marker.body, `failed: ${result.reason}`),
        ),
      );
    }
    await gate.mutate('claim', 'release after failure', () =>
      releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
    );
    const attempts =
      (await gate.mutate('label', 'bump attempts', () => bumpAttempts(deps.gh, item.ref))) ?? 1;
    if (attempts >= (deps.maxAttempts ?? 3)) {
      await gate.mutate('label', 'add looper:needs-human', () =>
        deps.gh.addLabels(item.ref, ['looper:needs-human']),
      );
    }
    return record({ status: 'failed', failure: { class: 'transient', reason: result.reason } });
  }

  // Completed: advance to the loop's target state, link artifacts, release.
  const note = result.pr
    ? `ingested PR #${result.pr.ref.number} (matched by ${result.matchedBy})`
    : `ingested result (matched by ${result.matchedBy})`;
  if (marker) {
    await gate.mutate('comment', 'mark dispatch resolved', () =>
      deps.gh.updateComment(item.ref, pending.commentId, markDispatchResolved(marker.body, note)),
    );
  }
  await gate.mutate('label', `state -> ${loop.transition.to}`, () =>
    applyStateChange(deps, item, loop.transition.to),
  );
  if (result.pr) {
    const pr = result.pr;
    await gate.mutate('label', `label PR #${pr.ref.number} ${loop.transition.to}`, () =>
      deps.gh.addLabels(pr.ref, [stateLabel(loop.transition.to)]),
    );
  }
  step('write', `state -> ${loop.transition.to}`);
  await gate.mutate('claim', 'release', async () => {
    await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
    await clearAttempts(deps.gh, item.ref);
  });
  const done = record({
    status: 'done',
    transition: `${loop.transition.from}->${loop.transition.to}`,
    artifacts: {
      ...(result.pr ? { pr: result.pr.ref.number } : {}),
      ...sessionArtifact(pending.handle.signal),
    },
  });
  const ingestNow = new Date();
  await syncPlanAfterTransition(
    deps.gh,
    deps.planFiles,
    gate,
    item,
    loop.transition.to,
    done,
    ingestNow,
  );
  return done;
}

/** One idempotent advisory comment per (loop, transition) in suggest mode. */
async function suggestAdvisory(
  deps: RunnerDeps,
  loop: LoopDefinition,
  item: IssueSnapshot,
  gate: EffectGate,
  action: string,
): Promise<void> {
  if (gate.mode !== 'suggest') return;
  const marker = `looper-suggest:${loop.name}:${loop.transition.from}->${loop.transition.to}`;
  await gate.comment(`suggest advisory (${marker})`, () =>
    upsertMarkedComment(
      deps.gh,
      item.ref,
      marker,
      `💡 looper (\`${loop.name}\`, suggest mode) would ${action}.\n\n` +
        `Promote with \`looper promote ${loop.name} --to act\` when ready.`,
    ).then(() => {}),
  );
}

async function applyStateChange(deps: RunnerDeps, item: IssueSnapshot, to: string): Promise<void> {
  const current = await deps.gh.getItemLabels(item.ref);
  const currentState = stateOfLabels(current);
  await deps.gh.addLabels(item.ref, [stateLabel(to)]);
  if (currentState && currentState !== to) {
    await deps.gh.removeLabel(item.ref, stateLabel(currentState));
  }
}

function sessionArtifact(signal: CorrelationSignal): { session?: string } | undefined {
  if (signal.kind === 'claude-session') return { session: signal.sessionUrl ?? signal.sessionId };
  if (signal.kind === 'codex-mention') return { session: `comment:${signal.commentId}` };
  return undefined;
}
