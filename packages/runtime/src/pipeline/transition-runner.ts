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
  backoffUntil,
  decideTransition,
  deriveRunId,
  evaluateDor,
  notBeforeLabel,
  parseCriteriaBlock,
  standardChecks,
  stateLabel,
  stateOfLabels,
  upsertCriteriaBlock,
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
import { ensembleDispatch, ensembleIngest, isEnsembleLoop } from './ensemble.js';
import {
  checkBlastRadius,
  decideMerge,
  evaluateRequiredChecks,
  linkedIssue,
  parseVerdict,
  verdictTarget,
} from './loop-actions.js';
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
  /** Repo identity flags (0029): fork-readonly writes defer to the sweep. */
  identity?: { writable: boolean; reTriggersWorkflows: boolean };
  /** The repo default branch (deploy-state checks run against it). */
  defaultBranch?: string;
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
    if (isEnsembleLoop(loop)) {
      return ensembleIngest(deps, loop, item, ours, gate, step, record);
    }
    return ingestPhase(deps, loop, item, ours[0]!, gate, steps, step, record);
  }

  // Fork-PR read-only caveat (0029): the event token cannot write — defer the
  // transition to the sweep (which runs in the base repo's privileged context).
  if (deps.identity?.writable === false && mode === 'act') {
    step('gate', 'deferred:fork-readonly (writes defer to the sweep)');
    return record({ status: 'skipped' });
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
      const { reason, retryAfter, holdLabel } = decision.verdict;
      const label = holdLabel ?? 'looper:parked';
      const approvalHold = label === 'looper:needs-approval';
      await gate.mutate('label', `add ${label} (${reason})`, () =>
        deps.gh.addLabels(item.ref, [label]),
      );
      await gate.comment(`park notice`, () =>
        upsertMarkedComment(
          deps.gh,
          item.ref,
          `looper:hold ${JSON.stringify({ reason, retryAfter: retryAfter ?? null })}`,
          (approvalHold
            ? `🔒 looper held this item for maintainer approval: ${reason}\n\n` +
              'A collaborator can apply `looper:approved` or run `looper approve`.'
            : `⏸️ looper parked this item: ${reason}`) +
            (retryAfter ? `\n\nWill retry after ${retryAfter}.` : ''),
        ).then(() => {}),
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
      // Deterministic transition (kind-aware): check-gated (deploy smoke),
      // DoD-gated merge, or a plain relabel.
      let target = loop.transition.to;

      // Check gate (0041/0047): required checks decide the landing state.
      if (
        loop.gates.requiredChecks &&
        loop.gates.requiredChecks.length > 0 &&
        target !== 'merged'
      ) {
        const ref = await checksRef(deps, item);
        const runs = await deps.gh.listCheckRuns(
          { owner: item.ref.owner, repo: item.ref.repo },
          ref,
        );
        const gateResult = evaluateRequiredChecks(runs, loop.gates.requiredChecks);
        step('gate', `required checks on ${ref}: ${gateResult}`);
        if (gateResult === 'waiting') {
          await gate.mutate('claim', 'release (checks pending)', () =>
            releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
          );
          return null; // re-evaluated next tick
        }
        if (gateResult === 'red') {
          if (!loop.transition.fallback) {
            await gate.mutate('label', 'add looper:needs-human', () =>
              deps.gh.addLabels(item.ref, ['looper:needs-human']),
            );
            await gate.mutate('claim', 'release', () =>
              releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
            );
            return record({
              status: 'escalated',
              failure: {
                class: 'terminal',
                reason: 'required checks failed; no fallback declared',
              },
            });
          }
          target = loop.transition.fallback;
        }
      }

      // The merge action (0045): DoD-gated, then an actual merge API call.
      if (loop.transition.to === 'merged' && item.kind === 'pull-request') {
        const pr = await deps.gh.getPullRequest(item.ref);
        const decision = await decideMerge(deps.gh, loop, pr);
        step('gate', `merge decision: ${decision.action}`);
        if (decision.action !== 'merge') {
          await gate.mutate('claim', `release (merge ${decision.action})`, () =>
            releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
          );
          if (decision.action === 'blocked') {
            await gate.comment('merge blocked notice', () =>
              deps.gh.createComment(
                item.ref,
                `🛑 looper merge blocked (DoD):\n${decision.reasons.map((r) => `- ${r}`).join('\n')}`,
              ),
            );
            return record({ status: 'skipped' });
          }
          return null; // waiting on checks/review — next tick
        }
        const merged = await gate.mutate('label', 'merge PR', () =>
          deps.gh.mergePullRequest(item.ref, { method: 'squash' }),
        );
        if (merged && !merged.merged) {
          await gate.mutate('claim', 'release (merge refused)', () =>
            releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
          );
          return record({
            status: 'failed',
            failure: {
              class: 'transient',
              reason: 'merge API refused (head moved or not mergeable)',
            },
          });
        }
        step('write', 'merged PR');
        // mirror the state onto the bound issue as well
        const issue = await linkedIssue(deps.gh, pr);
        if (issue) {
          await gate.mutate('label', `linked issue #${issue.ref.number} -> merged`, () =>
            applyStateChange(deps, issue, 'merged'),
          );
        }
      }

      await gate.mutate('label', `state -> ${target}`, () => applyStateChange(deps, item, target));
      step('write', `state -> ${target}`);
      await gate.mutate('claim', 'release', async () => {
        await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
        await clearAttempts(deps.gh, item.ref);
      });
      const done = record({
        status: 'done',
        transition: `${loop.transition.from}->${target}`,
      });
      await syncPlanAfterTransition(deps.gh, deps.planFiles, gate, item, target, done, now);
      await suggestAdvisory(
        deps,
        loop,
        item,
        gate,
        `advance \`${loop.transition.from}\` → \`${target}\``,
      );
      return done;
    }

    // Ensemble (M13 · 0055): dual-attempt fan-out, judged on a later tick.
    if (isEnsembleLoop(loop) && loop.gates.tier === 'core') {
      const fanned = await ensembleDispatch(deps, loop, item, runId, gate, step);
      if (fanned) {
        if (
          loop.transition.to !== 'in-progress' &&
          deps.table.edges.some((e) => e.from === loop.transition.from && e.to === 'in-progress')
        ) {
          await gate.mutate('label', 'state -> in-progress (ensemble dispatched)', () =>
            applyStateChange(deps, item, 'in-progress'),
          );
        }
        return record({ status: 'pending' });
      }
    }

    // Work-cell transition: compose → dispatch → persist handle → (maybe) mark
    // the intermediate state. Ingest happens on a later invocation.
    const source = deps.promptSource ?? promptSourceFromReader(deps.readPrompt, loop);
    const discussion = (await deps.gh.listComments(item.ref))
      .filter((c) => !c.body.includes('<!-- looper'))
      .slice(-10)
      .map((c) => ({ author: c.author.login, body: c.body.slice(0, 2000) }));
    const brief = await composeWorkBrief({
      loop,
      item,
      runId,
      source,
      comments: discussion,
      defaultBranch: deps.defaultBranch,
    });
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
    // Exponential backoff (0051): the sweep skips this item until the timer.
    const until = backoffUntil(attempts, now);
    await gate.mutate('label', `backoff until ${until}`, () =>
      deps.gh.addLabels(item.ref, [notBeforeLabel(until)]),
    );
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

  // Blast-radius guard (0038): scope-exceeding work halts and escalates —
  // the PR is never advanced into review.
  if (result.pr) {
    const changed = await deps.gh.listPullRequestFiles(result.pr.ref);
    const violation = checkBlastRadius(loop, result.pr, changed);
    if (violation) {
      step('gate', `blast radius: ${violation.reason}`);
      if (marker) {
        await gate.mutate('comment', 'mark dispatch resolved (blast radius)', () =>
          deps.gh.updateComment(
            item.ref,
            pending.commentId,
            markDispatchResolved(marker.body, `halted: ${violation.reason}`),
          ),
        );
      }
      await gate.mutate('label', 'add looper:needs-human', () =>
        deps.gh.addLabels(item.ref, ['looper:needs-human']),
      );
      await gate.comment('blast-radius escalation', () =>
        deps.gh.createComment(
          item.ref,
          `🚨 looper halted: ${violation.reason}. PR #${result.pr!.ref.number} needs a human ` +
            'decision (split the work or widen the loop limits consciously).',
        ),
      );
      await gate.mutate('claim', 'release', () =>
        releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {}),
      );
      return record({
        status: 'escalated',
        failure: { class: 'terminal', reason: violation.reason },
        artifacts: { pr: result.pr.ref.number },
      });
    }
  }

  // Verdict routing (0033/0042): comment-shaped results may land on the
  // fallback state (changes-requested, needs-clarification).
  let target = loop.transition.to;
  if (!result.pr && result.commentId !== undefined) {
    const verdictComment = (await deps.gh.listComments(item.ref)).find(
      (c) => c.id === result.commentId,
    );
    const verdict = verdictComment ? parseVerdict(verdictComment.body) : null;
    target = verdictTarget(loop, verdict);
    step('gate', `verdict: ${verdict ?? '(none)'} -> ${target}`);

    // Intent-diff attestation (0043): an approving review verdict means the
    // reviewer judged EVERY acceptance criterion met — mirror that onto the
    // issue's criteria block so the DoD merge gate can read it from GitHub
    // state alone. Unmet criteria route to the fallback, never here.
    if (target === 'verified') {
      const live = await deps.gh.getIssue(item.ref);
      const { criteria } = parseCriteriaBlock(live.body);
      if (criteria && criteria.some((c) => !c.met)) {
        await gate.mutate('label', 'attest criteria (review approved)', () =>
          deps.gh.updateIssueBody(
            item.ref,
            upsertCriteriaBlock(
              live.body,
              criteria.map((c) => ({ ...c, met: true })),
            ),
          ),
        );
      }
    }
  }

  // Completed: advance to the landing state, link artifacts, release.
  const note = result.pr
    ? `ingested PR #${result.pr.ref.number} (matched by ${result.matchedBy})`
    : `ingested result (matched by ${result.matchedBy})`;
  if (marker) {
    await gate.mutate('comment', 'mark dispatch resolved', () =>
      deps.gh.updateComment(item.ref, pending.commentId, markDispatchResolved(marker.body, note)),
    );
  }
  await gate.mutate('label', `state -> ${target}`, () => applyStateChange(deps, item, target));
  if (result.pr) {
    const pr = result.pr;
    await gate.mutate('label', `label PR #${pr.ref.number} ${target}`, () =>
      deps.gh.addLabels(pr.ref, [stateLabel(target)]),
    );
  }
  step('write', `state -> ${target}`);
  await gate.mutate('claim', 'release', async () => {
    await releaseClaim(deps.gh, item.ref, deps.botLogin ? { assignee: deps.botLogin } : {});
    await clearAttempts(deps.gh, item.ref);
  });
  const done = record({
    status: 'done',
    transition: `${loop.transition.from}->${target}`,
    artifacts: {
      ...(result.pr ? { pr: result.pr.ref.number } : {}),
      ...sessionArtifact(pending.handle.signal),
    },
  });
  const ingestNow = deps.now?.() ?? new Date();
  await syncPlanAfterTransition(deps.gh, deps.planFiles, gate, item, target, done, ingestNow);
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

/** Which git ref a deterministic loop's checks run against. */
async function checksRef(deps: RunnerDeps, item: IssueSnapshot): Promise<string> {
  if (item.kind === 'pull-request') {
    const pr = await deps.gh.getPullRequest(item.ref);
    return pr.merged ? (deps.defaultBranch ?? 'main') : pr.headRef;
  }
  return deps.defaultBranch ?? 'main';
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
