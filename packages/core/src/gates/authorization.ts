import type { AuthorizationConfig } from '../transitions/loop-definition.js';
import type { AuthorAssociation } from '../ports/types.js';
import type { RunRecord } from '../run-record/run-record.js';

/**
 * Authorization & trigger control (M17): pure WHO/WHAT/WHEN decisions the
 * runtime pre-flight enforces BEFORE claim/dispatch — the access-control
 * sibling of budget/quota/kill-switch. Safe by default: an untrusted trigger
 * is acknowledged but PARKED (needs-approval), never silently spent.
 */

// ---- WHO: actor trust (0079) ----

/** Minimum association each policy level treats as trusted. */
const ASSOCIATION_RANK: Record<AuthorAssociation, number> = {
  OWNER: 5,
  MEMBER: 4,
  COLLABORATOR: 3,
  CONTRIBUTOR: 2,
  FIRST_TIME_CONTRIBUTOR: 1,
  FIRST_TIMER: 1,
  MANNEQUIN: 0,
  NONE: 0,
};

const POLICY_FLOOR: Record<string, number> = {
  anyone: 0,
  'org-members': 4,
  collaborators: 3,
  allowlist: Infinity, // only `allow` entries pass
};

export interface ActorTrust {
  trusted: boolean;
  actor: string;
  reason: string;
}

export interface TriggerActor {
  login: string;
  isBot: boolean;
  association: AuthorAssociation;
  /** True for the cron "system" actor (trusted by construction). */
  system?: boolean;
}

/** `deny` always wins; `allow` overrides the association floor (e.g. a bot). */
export function resolveActorTrust(policy: AuthorizationConfig, actor: TriggerActor): ActorTrust {
  if (actor.system) {
    return { trusted: true, actor: 'system', reason: 'cron system actor' };
  }
  const deny = policy.deny ?? [];
  if (deny.includes(actor.login) || deny.includes('*')) {
    // an explicit allow still overrides a wildcard deny (documented intent)
    if (!(policy.allow ?? []).includes(actor.login)) {
      return { trusted: false, actor: actor.login, reason: `denied by deny list` };
    }
  }
  if ((policy.allow ?? []).includes(actor.login)) {
    return { trusted: true, actor: actor.login, reason: 'on the allow list' };
  }
  const floor = POLICY_FLOOR[policy.actors] ?? POLICY_FLOOR['collaborators']!;
  const rank = ASSOCIATION_RANK[actor.association] ?? 0;
  if (rank >= floor) {
    return { trusted: true, actor: actor.login, reason: `${actor.association} ≥ ${policy.actors}` };
  }
  return {
    trusted: false,
    actor: actor.login,
    reason: `${actor.association} below '${policy.actors}' and not allow-listed`,
  };
}

/** Strictest-wins merge of the repo default with a per-loop override (0079). */
export function resolveAuthorizationPolicy(
  root: AuthorizationConfig,
  loop?: AuthorizationConfig,
): AuthorizationConfig {
  if (!loop) return root;
  const order = ['anyone', 'org-members', 'collaborators', 'allowlist'];
  const stricterActors =
    order.indexOf(loop.actors) >= order.indexOf(root.actors) ? loop.actors : root.actors;
  return {
    ...root,
    ...loop,
    actors: stricterActors,
    allow: [...(root.allow ?? []), ...(loop.allow ?? [])],
    deny: [...(root.deny ?? []), ...(loop.deny ?? [])],
  };
}

// ---- WHAT: trigger source + bot controls (0081) ----

export interface TriggerSourceDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Does this loop act on this delivered event, from this (possibly bot) actor?
 * `trigger_sources` (when set) is an authorization-scoped allow-list of event
 * selectors beyond the loop's natural trigger; bots need explicit allow.
 */
export function triggerSourceAllowed(
  policy: AuthorizationConfig & {
    triggerSources?: string[] | undefined;
    botAllow?: string[] | undefined;
    botDeny?: string[] | undefined;
  },
  eventSelector: string,
  actor: TriggerActor,
): TriggerSourceDecision {
  if (policy.triggerSources && policy.triggerSources.length > 0) {
    const base = eventSelector.split('[')[0]!;
    const matched = policy.triggerSources.some((s) => s === eventSelector || s === base);
    if (!matched) {
      return {
        allowed: false,
        reason: `event '${eventSelector}' not in this loop's trigger_sources`,
      };
    }
  }
  if (actor.isBot && !actor.system) {
    const allow = policy.botAllow ?? policy.allowedBots ?? [];
    const deny = policy.botDeny ?? [];
    if (deny.includes(actor.login) || (deny.includes('*') && !allow.includes(actor.login))) {
      return { allowed: false, reason: `bot '${actor.login}' is on the bot deny list` };
    }
    if (allow.length > 0 && !allow.includes(actor.login)) {
      return { allowed: false, reason: `bot '${actor.login}' not on the bot allow list` };
    }
  }
  return { allowed: true, reason: 'trigger source permitted' };
}

// ---- WHEN: rate limits + schedule windows (0082) ----

export type WhenVerdict =
  | { verdict: 'allow' }
  | { verdict: 'defer'; until?: string | undefined; reason: string }
  | { verdict: 'park'; reason: string };

/** Count an actor's effective dispatches and the global rate from the ledger. */
export function rateLimitGate(
  records: readonly RunRecord[],
  actor: string,
  config: { perActorPerDay?: number | undefined; globalPerHour?: number | undefined } | undefined,
  now: Date,
): WhenVerdict {
  if (!config) return { verdict: 'allow' };
  const dispatched = records.filter((r) => r.steps.some((s) => s.kind === 'dispatch'));
  if (config.perActorPerDay && config.perActorPerDay > 0) {
    const dayStart = now.getTime() - 86_400_000;
    const byActor = dispatched.filter(
      (r) => Date.parse(r.trigger.at) >= dayStart && r.outcome.artifacts?.session !== actor,
    );
    // attribute by the run's recorded actor when present; fall back to count-all
    const actorCount = byActor.length;
    if (actorCount + 1 > config.perActorPerDay) {
      return {
        verdict: 'defer',
        until: new Date(dayStart + 86_400_000).toISOString(),
        reason: `actor '${actor}' over ${config.perActorPerDay}/day`,
      };
    }
  }
  if (config.globalPerHour && config.globalPerHour > 0) {
    const hourStart = now.getTime() - 3_600_000;
    const recent = dispatched.filter((r) => Date.parse(r.trigger.at) >= hourStart).length;
    if (recent + 1 > config.globalPerHour) {
      return {
        verdict: 'defer',
        until: new Date(hourStart + 3_600_000).toISOString(),
        reason: `global rate over ${config.globalPerHour}/hour`,
      };
    }
  }
  return { verdict: 'allow' };
}

export interface ScheduleWindow {
  days?: string[] | undefined;
  hours?: string | undefined;
  tz?: string | undefined;
}

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Is `now` inside the loop's allowed window? Defers to the next open slot. */
export function scheduleWindowGate(window: ScheduleWindow | undefined, now: Date): WhenVerdict {
  if (!window || (!window.days && !window.hours)) return { verdict: 'allow' };
  // Window evaluation is in UTC for determinism; tz is advisory metadata in V1.
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  if (window.days && window.days.length > 0) {
    const allowedDays = expandDays(window.days);
    if (!allowedDays.has(day)) {
      return { verdict: 'defer', reason: `outside schedule window (day ${day} not allowed)` };
    }
  }
  if (window.hours) {
    const m = window.hours.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (hour < start || hour >= end) {
        return {
          verdict: 'defer',
          reason: `outside schedule window (hour ${hour} not in ${window.hours})`,
        };
      }
    }
  }
  return { verdict: 'allow' };
}

function expandDays(days: string[]): Set<number> {
  const out = new Set<number>();
  for (const entry of days) {
    const range = entry.toLowerCase().match(/^([a-z]{3})-([a-z]{3})$/);
    if (range) {
      const start = DAY_INDEX[range[1]!];
      const end = DAY_INDEX[range[2]!];
      if (start !== undefined && end !== undefined) {
        for (let d = start; d !== (end + 1) % 7; d = (d + 1) % 7) out.add(d);
        out.add(end);
      }
    } else {
      const d = DAY_INDEX[entry.toLowerCase()];
      if (d !== undefined) out.add(d);
    }
  }
  return out;
}

export const NEEDS_APPROVAL_LABEL = 'loopdog:needs-approval';
export const DEFAULT_APPROVAL_LABEL = 'loopdog:approved';
