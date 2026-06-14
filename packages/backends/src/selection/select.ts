// Selection precedence is pure domain logic and lives in core (0023);
// re-exported here because this package is its spec home.
export { deriveStage, selectBackend } from '@loopdog/core';
export type { Stage } from '@loopdog/core';

export class UnknownBackendError extends Error {
  constructor(name: string, known: string[]) {
    super(
      `unknown backend '${name}' — known backends: ${known.join(', ')}. ` +
        'Check `backend:`/`review_backend:` in loop.yml and `backends.default` in loopdog.yml.',
    );
    this.name = 'UnknownBackendError';
  }
}

export class BackendAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendAuthError';
  }
}

/** Opaque pointer to a credential (env-var / Actions secret NAME) — never a value. */
export type SecretRef = string;

export type BackendAuth =
  | { kind: 'claude'; fireUrl: SecretRef; routineToken: SecretRef }
  | { kind: 'codex'; providerAppRequired: true }
  | { kind: 'self-hosted'; apiKey: SecretRef };

/**
 * Resolve the credential REFERENCES a backend needs (task 0023). No plaintext
 * model API key ever passes through here; Claude/Codex hold none at all.
 */
export function resolveAuth(
  name: string,
  ctx: { env?: NodeJS.ProcessEnv; zdr?: boolean; apiKeySecretName?: string } = {},
): BackendAuth {
  const env = ctx.env ?? process.env;
  switch (name) {
    case 'claude': {
      if (ctx.zdr) {
        throw new BackendAuthError(
          'this org is Zero-Data-Retention: Claude cloud routines are excluded — ' +
            'select the self-hosted backend (`loopdog connect default self-hosted`)',
        );
      }
      if (env['ANTHROPIC_API_KEY'] && !env['LOOPDOG_CLAUDE_FIRE_URL']) {
        throw new BackendAuthError(
          'ANTHROPIC_API_KEY does NOT satisfy Claude subscription auth — loopdog’s Claude ' +
            'backend uses an imported routine /fire URL + bearer token. ' +
            'Run `loopdog connect claude` (the API-key path belongs to the self-hosted backend).',
        );
      }
      if (!env['LOOPDOG_CLAUDE_FIRE_URL'] || !env['LOOPDOG_CLAUDE_FIRE_TOKEN']) {
        throw new BackendAuthError(
          'Claude routine not imported: missing LOOPDOG_CLAUDE_FIRE_URL / ' +
            'LOOPDOG_CLAUDE_FIRE_TOKEN secret refs — run `loopdog connect claude` ' +
            '(regenerate the token in Claude and use --rotate to re-import)',
        );
      }
      return {
        kind: 'claude',
        fireUrl: 'LOOPDOG_CLAUDE_FIRE_URL',
        routineToken: 'LOOPDOG_CLAUDE_FIRE_TOKEN',
      };
    }
    case 'codex':
      // Dispatch is just a GitHub comment — loopdog holds no provider token.
      return { kind: 'codex', providerAppRequired: true };
    case 'self-hosted':
      return { kind: 'self-hosted', apiKey: ctx.apiKeySecretName ?? 'LOOPDOG_MODEL_API_KEY' };
    default:
      throw new UnknownBackendError(name, ['claude', 'codex', 'self-hosted']);
  }
}
