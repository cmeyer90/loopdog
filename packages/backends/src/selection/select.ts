// Selection precedence is pure domain logic and lives in core (0023);
// re-exported here because this package is its spec home.
export { deriveStage, selectBackend } from '@looper/core';
export type { Stage } from '@looper/core';

export class UnknownBackendError extends Error {
  constructor(name: string, known: string[]) {
    super(
      `unknown backend '${name}' — known backends: ${known.join(', ')}. ` +
        'Check `backend:`/`review_backend:` in loop.yml and `backends.default` in looper.yml.',
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
            'select the self-hosted backend (`looper connect default self-hosted`)',
        );
      }
      if (env['ANTHROPIC_API_KEY'] && !env['LOOPER_CLAUDE_FIRE_URL']) {
        throw new BackendAuthError(
          'ANTHROPIC_API_KEY does NOT satisfy Claude subscription auth — looper’s Claude ' +
            'backend uses an imported routine /fire URL + bearer token. ' +
            'Run `looper connect claude` (the API-key path belongs to the self-hosted backend).',
        );
      }
      if (!env['LOOPER_CLAUDE_FIRE_URL'] || !env['LOOPER_CLAUDE_FIRE_TOKEN']) {
        throw new BackendAuthError(
          'Claude routine not imported: missing LOOPER_CLAUDE_FIRE_URL / ' +
            'LOOPER_CLAUDE_FIRE_TOKEN secret refs — run `looper connect claude` ' +
            '(regenerate the token in Claude and use --rotate to re-import)',
        );
      }
      return {
        kind: 'claude',
        fireUrl: 'LOOPER_CLAUDE_FIRE_URL',
        routineToken: 'LOOPER_CLAUDE_FIRE_TOKEN',
      };
    }
    case 'codex':
      // Dispatch is just a GitHub comment — looper holds no provider token.
      return { kind: 'codex', providerAppRequired: true };
    case 'self-hosted':
      return { kind: 'self-hosted', apiKey: ctx.apiKeySecretName ?? 'LOOPER_MODEL_API_KEY' };
    default:
      throw new UnknownBackendError(name, ['claude', 'codex', 'self-hosted']);
  }
}
