import type {
  ExecutionBackend,
  GitHubPort,
  IssueSnapshot,
  LoopDefinition,
  PreflightCheck,
  RepoRef,
  RunRecord,
  TriggerEvent,
} from '@loopdog/core';
import {
  NEEDS_APPROVAL_LABEL,
  backendDispatchesInWindow,
  breakerStatus,
  budgetGate,
  checkCeiling,
  killSwitchGate,
  ledgerStats,
  quotaGate,
  rateLimitGate,
  resolveActorTrust,
  resolveAuthorizationPolicy,
  scheduleWindowGate,
  toBreakerPolicy,
  toCeiling,
  triggerSourceAllowed,
} from '@loopdog/core';
import { breakerStateFromLedger, inFlightFor } from './resilience.js';
import type { AuthorizationConfig, QuotaModel, TriggerActor } from '@loopdog/core';
import type { RunRecordStore } from '../telemetry/record-store.js';

/**
 * The effectful pre-flight (M12): composes kill-switch → budget → quota into
 * `PreflightCheck`s the runner evaluates before any claim/dispatch — in
 * cheap→expensive order, first denial wins. Denials PARK (loopdog:parked with
 * a retryAfter the sweep honors), never fail.
 */

export interface PreflightConfig {
  budgets: {
    window: 'daily' | 'weekly' | 'monthly';
    global: { max_dispatches: number; max_usd: number };
    per_loop: { max_dispatches: number; max_usd: number };
    on_exceeded: 'park' | 'needs-human';
  };
  kill_switch: { variable: string; label: string };
  quota: {
    window: 'daily' | 'weekly' | 'monthly';
    on_exceeded: 'defer' | 'park';
    backends?:
      | Record<string, { window?: string | undefined; max_dispatches?: number | undefined }>
      | undefined;
  };
  /** Repo-default authorization policy (M17); per-loop tightens it. */
  authorization?: AuthorizationConfig | undefined;
}

export interface PreflightDeps {
  gh: GitHubPort;
  records: RunRecordStore;
  backends: ReadonlyMap<string, ExecutionBackend>;
  repo: RepoRef;
  config: PreflightConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const WINDOW_MS: Record<string, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

export function createPreflight(deps: PreflightDeps) {
  return async (ctx: {
    loop: LoopDefinition;
    item: IssueSnapshot;
    trigger: TriggerEvent;
  }): Promise<PreflightCheck[]> => {
    const checks: PreflightCheck[] = [];
    const now = deps.now?.() ?? new Date();

    // Only dispatching work spends anything; deterministic relabels are free.
    if (!ctx.loop.expects) return checks;

    // 0. authorization (M17): WHO/WHAT/WHEN, before any spend. Already-approved
    //    items pass straight through (the release was checked at label time).
    const rootAuth = deps.config.authorization;
    if (
      rootAuth &&
      !ctx.item.labels.includes(ctx.loop.authorization?.approvalLabel ?? 'loopdog:approved')
    ) {
      const policy = resolveAuthorizationPolicy(rootAuth, ctx.loop.authorization);
      const actor = triggerActor(ctx.trigger);

      const trust = resolveActorTrust(policy, actor);
      const source = triggerSourceAllowed(
        {
          ...policy,
          triggerSources: ctx.loop.authorization?.triggerSources,
          botAllow: ctx.loop.authorization?.botAllow ?? policy.allowedBots,
          botDeny: ctx.loop.authorization?.botDeny,
        },
        ctx.trigger.kind === 'event' ? ctx.trigger.name : 'cron',
        actor,
      );
      const unauthorized = !trust.trusted || !source.allowed;
      if (unauthorized) {
        const reason = !trust.trusted ? trust.reason : source.reason;
        const mode = policy.onUnauthorized;
        if (mode === 'ignore') {
          checks.push({ name: 'guard:authorization', verdict: { kind: 'skip', reason } });
          return checks;
        }
        // park (default) and comment both refuse dispatch; park holds for approval.
        checks.push({
          name: 'guard:authorization',
          verdict: {
            kind: 'park',
            reason: `untrusted trigger (${actor.login}): ${reason}`,
            holdLabel: NEEDS_APPROVAL_LABEL,
          },
        });
        return checks;
      }

      // WHEN: per-actor + global rate caps, then the schedule window.
      const records = await recentRecords(deps.records, now, 2);
      const rate = rateLimitGate(records, actor.login, policy.rateLimit, now);
      if (rate.verdict !== 'allow') {
        checks.push({
          name: 'guard:rate-limit',
          verdict: {
            kind: 'park',
            reason: rate.reason,
            ...(rate.verdict === 'defer' && rate.until ? { retryAfter: rate.until } : {}),
          },
        });
        return checks;
      }
      const win = scheduleWindowGate(policy.scheduleWindow, now);
      if (win.verdict !== 'allow') {
        checks.push({
          name: 'guard:schedule-window',
          verdict: { kind: 'park', reason: win.reason },
        });
        return checks;
      }
      checks.push({ name: 'guard:authorization', verdict: { kind: 'proceed' } });
    }

    // The run-record ledger (GitHub state) backs the resilience gates + budget.
    const records = await recentRecords(deps.records, now, 31);

    // Resilience (M19 · 0090): circuit breaker first (a provider outage pauses
    // the whole loop — skip, no spend), then the concurrency ceiling (too much
    // in flight → defer this candidate). Both `skip` (no attempt increment); the
    // sweep retries once the cooldown elapses / headroom frees.
    const breakerPolicy = toBreakerPolicy(ctx.loop.resilience);
    const breaker = breakerStatus(
      breakerStateFromLedger(records, ctx.loop.name, ctx.loop.backend, breakerPolicy),
      breakerPolicy,
      now,
    );
    if (!breaker.admit) {
      checks.push({
        name: 'guard:circuit-breaker',
        verdict: { kind: 'skip', reason: breaker.reason },
      });
      return checks;
    }
    const ceiling = checkCeiling(
      inFlightFor(records, ctx.loop.name),
      toCeiling(ctx.loop.resilience),
    );
    if (!ceiling.admit) {
      checks.push({ name: 'guard:concurrency', verdict: { kind: 'skip', reason: ceiling.reason } });
      return checks;
    }

    // 1. kill switch (cheapest): repo variable (authoritative) — the
    //    loopdog:stop label on the ITEM is already a standard hold.
    const env = deps.env ?? process.env;
    const kill = killSwitchGate({
      variableSet: Boolean(env[deps.config.kill_switch.variable]),
      labelPresent: false,
    });
    checks.push(toCheck('guard:kill-switch', kill));
    if (!kill.allowed) return checks;

    // 2 + 3. budget then quota, over the run-record ledger.
    const windowMs = WINDOW_MS[deps.config.budgets.window] ?? WINDOW_MS['monthly']!;
    const stats = ledgerStats(records, ctx.loop.name, new Date(now.getTime() - windowMs));
    const budget = budgetGate(stats, {
      windowMs,
      global: {
        maxDispatches: deps.config.budgets.global.max_dispatches,
        maxUsd: deps.config.budgets.global.max_usd,
      },
      perLoop: {
        maxDispatches: deps.config.budgets.per_loop.max_dispatches,
        maxUsd: deps.config.budgets.per_loop.max_usd,
      },
    });
    checks.push(toCheck('guard:budget', budget, deps.config.budgets.on_exceeded));
    if (!budget.allowed) return checks;

    const model = quotaModelFor(deps, ctx.loop.backend);
    const dispatched = model ? backendDispatchesInWindow(records, ctx.loop.backend, model, now) : 0;
    const quota = quotaGate(dispatched, ctx.loop.backend, model, now);
    checks.push(toCheck('guard:quota', quota));
    return checks;
  };
}

/** Backend cap: config override > capability default (throughput.tasksPerHour). */
function quotaModelFor(deps: PreflightDeps, backend: string): QuotaModel | undefined {
  const override = deps.config.quota.backends?.[backend];
  if (override?.max_dispatches !== undefined) {
    const win = override.window ?? '1h';
    return {
      maxDispatches: override.max_dispatches,
      windowMs: win === '24h' || win === 'daily' ? 86_400_000 : 3_600_000,
      kind: win === '24h' || win === 'daily' ? 'calendar' : 'rolling',
    };
  }
  const caps = deps.backends.get(backend)?.capabilities();
  if (caps?.throughput.tasksPerHour != null) {
    return { maxDispatches: caps.throughput.tasksPerHour, windowMs: 3_600_000, kind: 'rolling' };
  }
  return undefined; // uncapped (self-hosted / unknown)
}

/** Build the trust actor from a normalized trigger (cron = the system actor). */
function triggerActor(trigger: {
  kind: string;
  name?: string;
  actor?: { login: string; type: string } | undefined;
  authorAssociation?: string | undefined;
}): TriggerActor {
  if (trigger.kind === 'cron') {
    return { login: 'system', isBot: true, association: 'NONE', system: true };
  }
  const login = trigger.actor?.login ?? 'unknown';
  return {
    login,
    isBot: trigger.actor?.type === 'Bot',
    association: (trigger.authorAssociation ?? 'NONE') as TriggerActor['association'],
  };
}

async function recentRecords(store: RunRecordStore, now: Date, days: number): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (let back = 0; back < days; back++) {
    const day = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    records.push(...(await store.readDay(day)));
  }
  return records;
}

function toCheck(
  name: string,
  verdict: ReturnType<typeof killSwitchGate>,
  onExceeded: 'park' | 'needs-human' = 'park',
): PreflightCheck {
  if (verdict.allowed) return { name, verdict: { kind: 'proceed' } };
  if (onExceeded === 'needs-human') {
    return { name, verdict: { kind: 'escalate', reason: verdict.reason } };
  }
  return {
    name,
    verdict: { kind: 'park', reason: verdict.reason, retryAfter: verdict.retryAfter },
  };
}
