import net from 'node:net';

/**
 * Hermeticity guard for tiers 1–4 (task 0087): the load-bearing guarantee that
 * per-PR CI spends ZERO quota. Any outbound socket to a real host becomes a
 * thrown error (a red test, not a silent network/quota burn), and the presence
 * of a provider/`GITHUB_TOKEN` secret in the job env is a hard failure.
 *
 * Localhost / unix sockets are allowed — vitest's own worker IPC needs them;
 * the allowlist for *external* hosts is empty, exactly as the spec requires.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

function isLocal(host: string | undefined): boolean {
  if (!host) return true; // unix socket / IPC (no host) — allowed
  return LOCAL_HOSTS.has(host) || host.endsWith('.local');
}

export interface NetworkGuard {
  /** Restore the original socket behavior. */
  uninstall(): void;
  /** Hosts that were blocked during the guarded window (for diagnostics). */
  readonly blocked: string[];
}

/**
 * Monkeypatch `net.Socket.connect` to throw on any non-local TCP connect.
 * Returns a handle to uninstall (so tier-5 can opt out). Idempotent-safe.
 */
export function installNetworkGuard(): NetworkGuard {
  const blocked: string[] = [];
  const original = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function patched(this: net.Socket, ...args: unknown[]) {
    const host = extractHost(args);
    if (!isLocal(host)) {
      blocked.push(host ?? '<unknown>');
      throw new Error(
        `network guard (tiers 1–4): blocked outbound connection to '${host}'. ` +
          'Hermetic tiers must use the fakes/replay cassettes — no real GitHub or provider IO. ' +
          'If this is a live-smoke test, name it *.live.test.ts (tier 5).',
      );
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof original;

  return {
    blocked,
    uninstall() {
      net.Socket.prototype.connect = original;
    },
  };
}

/** Pull the destination host out of the polymorphic Socket.connect signature. */
function extractHost(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'object' && first !== null) {
    const opts = first as { host?: string; path?: string };
    if (opts.path) return undefined; // unix socket / IPC
    return opts.host ?? 'localhost';
  }
  // connect(port, host?, cb?) — host is the second arg when it's a string.
  if (typeof second === 'string') return second;
  return 'localhost';
}

/** Secret names that must be ABSENT in the tiers-1–4 job env. */
export const FORBIDDEN_SECRET_ENV = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'LOOPER_PROVIDER_TOKEN',
];

export interface SecretAbsenceResult {
  ok: boolean;
  present: string[];
}

/**
 * Assert no provider/`GITHUB_TOKEN` secret is present — the third leg of the
 * zero-quota guarantee (a leaked secret means a leaked spend path).
 */
export function assertNoSecrets(env: NodeJS.ProcessEnv = process.env): SecretAbsenceResult {
  const present = FORBIDDEN_SECRET_ENV.filter((k) => {
    const v = env[k];
    return typeof v === 'string' && v.length > 0;
  });
  return { ok: present.length === 0, present };
}
