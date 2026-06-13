import { describe, expect, it } from 'vitest';
import {
  rateLimitGate,
  resolveActorTrust,
  resolveAuthorizationPolicy,
  scheduleWindowGate,
  triggerSourceAllowed,
} from '@looper/core';
import type { AuthorizationConfig, RunRecord, TriggerActor } from '@looper/core';

const base: AuthorizationConfig = { actors: 'collaborators', onUnauthorized: 'park' };

function actor(partial: Partial<TriggerActor>): TriggerActor {
  return { login: 'x', isBot: false, association: 'NONE', ...partial };
}

describe('actor trust (0079)', () => {
  it('maps association to the policy floor; deny wins; allow overrides; cron trusted', () => {
    expect(resolveActorTrust(base, actor({ association: 'COLLABORATOR' })).trusted).toBe(true);
    expect(resolveActorTrust(base, actor({ association: 'CONTRIBUTOR' })).trusted).toBe(false);
    expect(
      resolveActorTrust({ ...base, actors: 'org-members' }, actor({ association: 'COLLABORATOR' }))
        .trusted,
    ).toBe(false);
    expect(
      resolveActorTrust({ ...base, actors: 'anyone' }, actor({ association: 'NONE' })).trusted,
    ).toBe(true);

    // allow overrides the floor (e.g. a bot)
    expect(
      resolveActorTrust(
        { ...base, allow: ['dependabot[bot]'] },
        actor({ login: 'dependabot[bot]', isBot: true }),
      ).trusted,
    ).toBe(true);
    // deny always wins
    expect(
      resolveActorTrust(
        { ...base, deny: ['spammer'] },
        actor({ login: 'spammer', association: 'OWNER' }),
      ).trusted,
    ).toBe(false);
    // cron is the trusted system actor
    expect(resolveActorTrust(base, actor({ system: true })).trusted).toBe(true);
    // allowlist policy: only allow entries pass
    expect(
      resolveActorTrust(
        { ...base, actors: 'allowlist', allow: ['dana'] },
        actor({ login: 'dana', association: 'NONE' }),
      ).trusted,
    ).toBe(true);
    expect(
      resolveActorTrust(
        { ...base, actors: 'allowlist', allow: ['dana'] },
        actor({ login: 'eve', association: 'OWNER' }),
      ).trusted,
    ).toBe(false);
  });

  it('strictest-wins policy resolution (a loop tightens, never loosens)', () => {
    const merged = resolveAuthorizationPolicy(
      { actors: 'collaborators', onUnauthorized: 'park', allow: ['root-bot'] },
      { actors: 'allowlist', onUnauthorized: 'park', allow: ['loop-bot'] },
    );
    expect(merged.actors).toBe('allowlist'); // stricter wins
    expect(merged.allow).toEqual(['root-bot', 'loop-bot']);

    const loosenAttempt = resolveAuthorizationPolicy(
      { actors: 'collaborators', onUnauthorized: 'park' },
      { actors: 'anyone', onUnauthorized: 'park' },
    );
    expect(loosenAttempt.actors).toBe('collaborators'); // cannot loosen below the root
  });
});

describe('trigger source + bot controls (0081)', () => {
  it('restricts to configured event selectors when set', () => {
    const policy = { ...base, triggerSources: ['issues.labeled', 'pull_request.closed[merged]'] };
    expect(triggerSourceAllowed(policy, 'issues.labeled', actor({})).allowed).toBe(true);
    expect(triggerSourceAllowed(policy, 'pull_request.closed[merged]', actor({})).allowed).toBe(
      true,
    );
    expect(triggerSourceAllowed(policy, 'issue_comment.created', actor({})).allowed).toBe(false);
  });

  it('bots need explicit allow; an allowed bot drives, an unknown bot is rejected', () => {
    const policy = { ...base, botAllow: ['dependabot[bot]'], botDeny: ['*'] };
    expect(
      triggerSourceAllowed(
        policy,
        'issues.opened',
        actor({ login: 'dependabot[bot]', isBot: true }),
      ).allowed,
    ).toBe(true);
    expect(
      triggerSourceAllowed(policy, 'issues.opened', actor({ login: 'rando[bot]', isBot: true }))
        .allowed,
    ).toBe(false);
    // humans are unaffected by bot lists
    expect(triggerSourceAllowed(policy, 'issues.opened', actor({ login: 'dana' })).allowed).toBe(
      true,
    );
  });
});

describe('rate limits + schedule windows (0082)', () => {
  const NOW = new Date('2026-06-10T12:00:00Z'); // a Wednesday, noon UTC
  function rec(at: string): RunRecord {
    return {
      runId: at,
      loop: 'implement',
      item: { owner: 'o', repo: 'r', number: 1 },
      trigger: { kind: 'event', at },
      backend: 'claude',
      steps: [{ t: at, kind: 'dispatch', detail: 'ok' }],
      outcome: { status: 'done' },
      cost: {},
    };
  }

  it('global-per-hour defers when the hour is full', () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      rec(new Date(NOW.getTime() - i * 60_000).toISOString()),
    );
    const verdict = rateLimitGate(records, 'dana', { globalPerHour: 20 }, NOW);
    expect(verdict.verdict).toBe('defer');
    expect(rateLimitGate([], 'dana', { globalPerHour: 20 }, NOW).verdict).toBe('allow');
  });

  it('schedule window defers outside allowed days/hours (UTC)', () => {
    // Wed noon is inside mon-fri 09-18
    expect(scheduleWindowGate({ days: ['mon-fri'], hours: '09-18' }, NOW).verdict).toBe('allow');
    // 20:00 is outside 09-18
    expect(scheduleWindowGate({ hours: '09-18' }, new Date('2026-06-10T20:00:00Z')).verdict).toBe(
      'defer',
    );
    // Sunday is outside mon-fri
    expect(
      scheduleWindowGate({ days: ['mon-fri'] }, new Date('2026-06-14T12:00:00Z')).verdict,
    ).toBe('defer');
    // no window → always allow
    expect(scheduleWindowGate(undefined, NOW).verdict).toBe('allow');
  });
});
