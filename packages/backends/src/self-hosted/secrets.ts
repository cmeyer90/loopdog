/**
 * Self-hosted secret stores (task 0031). On the **self-hosted** backend only,
 * looper resolves the adopter's own project secrets at dispatch time — from the
 * worker's injected env (`actions`), a Vault KV-v2 path (`vault`), or the
 * Doppler API (`doppler`). `oidc` performs no cloud-specific token exchange
 * itself; it returns explicit guidance to run your cloud's exchange action in
 * the worker job and read the result via the `actions` store.
 *
 * Resolved values are injected only into the adopter's container env and fed to
 * the {@link Scrubber}; they are never serialized into a brief, prompt, plan,
 * run record, or any GitHub-visible artifact. Resolution is FAIL-CLOSED: a
 * secret that cannot be resolved throws {@link SecretResolutionError} so the
 * dispatch fails rather than running the work cell without it. This module
 * never logs a secret value.
 */

/** The stores an adopter may select via `secrets.store` (self-hosted path only). */
export type SecretSource = 'actions' | 'oidc' | 'vault' | 'doppler';

/**
 * One requested secret: the env-var `name` to expose in the work cell, the
 * `from` store to pull it from (defaults to the store's own source), and an
 * optional store-specific `key`/path (e.g. a Vault path, or a Doppler name).
 */
export interface SecretRefSpec {
  name: string;
  from?: SecretSource;
  key?: string;
}

/** A resolved secret. `value` must never reach a model- or GitHub-visible artifact. */
export interface ResolvedSecret {
  name: string;
  value: string;
  source: SecretSource;
}

/** A pluggable secret store: resolves refs to values at dispatch, fail-closed. */
export interface SecretStore {
  readonly source: SecretSource;
  resolve(refs: SecretRefSpec[]): Promise<ResolvedSecret[]>;
}

/**
 * Thrown when a secret cannot be resolved. Dispatch must fail closed on this —
 * never run the work cell without the secret. Carries no secret value.
 */
export class SecretResolutionError extends Error {
  constructor(
    readonly secretName: string,
    readonly source: SecretSource,
    reason: string,
  ) {
    super(`could not resolve secret "${secretName}" from ${source}: ${reason}`);
    this.name = 'SecretResolutionError';
  }
}

/**
 * `actions` store — values arrive as environment variables injected by the
 * adopter's own worker workflow (`env:`/`secrets:`). Resolves `ref.key ?? ref.name`
 * from the process env and FAILS CLOSED when a name is absent or empty.
 */
export function actionsSecretStore(env: NodeJS.ProcessEnv = process.env): SecretStore {
  return {
    source: 'actions',
    async resolve(refs) {
      const out: ResolvedSecret[] = [];
      for (const ref of refs) {
        const key = ref.key ?? ref.name;
        const value = env[key];
        if (value === undefined || value === '') {
          throw new SecretResolutionError(
            ref.name,
            'actions',
            `environment variable ${key} is not set in the worker job — add it to the ` +
              `worker workflow's env:/secrets: block`,
          );
        }
        out.push({ name: ref.name, value, source: 'actions' });
      }
      return out;
    },
  };
}

/** Options for {@link vaultSecretStore}. */
export interface VaultStoreOptions {
  /** Vault address, e.g. `https://vault.example.com`. Defaults to `$VAULT_ADDR`. */
  address?: string;
  /** Vault token used in the `X-Vault-Token` header. Defaults to `$VAULT_TOKEN`. */
  token?: string;
  /** KV-v2 mount point. Defaults to `$VAULT_KV_MOUNT` or `secret`. */
  mount?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * `vault` store — reads from a Vault KV-v2 engine. Each ref's `key` is the
 * secret path (optionally `path#field`); the field defaults to the ref name,
 * then a sole string field, then a `value` field. Authenticates with the
 * `X-Vault-Token` header. Fails closed on auth/transport/missing-field errors.
 */
export function vaultSecretStore(options: VaultStoreOptions = {}): SecretStore {
  const env = options.env ?? process.env;
  const address = options.address ?? env.VAULT_ADDR;
  const token = options.token ?? env.VAULT_TOKEN;
  const mount = options.mount ?? env.VAULT_KV_MOUNT ?? 'secret';
  const doFetch = options.fetchImpl ?? fetch;
  return {
    source: 'vault',
    async resolve(refs) {
      if (!address) throw new SecretResolutionError('*', 'vault', 'VAULT_ADDR is not configured');
      if (!token) throw new SecretResolutionError('*', 'vault', 'VAULT_TOKEN is not configured');
      const out: ResolvedSecret[] = [];
      for (const ref of refs) {
        const [path, field] = splitPathField(ref.key ?? ref.name);
        const url = `${trimTrailingSlash(address)}/v1/${mount}/data/${path}`;
        const res = await doFetch(url, { headers: { 'X-Vault-Token': token } }).catch(
          (cause: unknown) => {
            throw new SecretResolutionError(
              ref.name,
              'vault',
              `request to Vault failed: ${errMessage(cause)}`,
            );
          },
        );
        if (!res.ok) {
          throw new SecretResolutionError(
            ref.name,
            'vault',
            `Vault returned HTTP ${res.status} for ${mount}/${path}`,
          );
        }
        const data = readNestedData((await res.json()) as unknown);
        const value = pickField(data, field ?? ref.name);
        if (value === undefined) {
          throw new SecretResolutionError(
            ref.name,
            'vault',
            `no usable string field at ${mount}/${path}`,
          );
        }
        out.push({ name: ref.name, value, source: 'vault' });
      }
      return out;
    },
  };
}

/** Options for {@link dopplerSecretStore}. */
export interface DopplerStoreOptions {
  /** Doppler service token (Bearer). Defaults to `$DOPPLER_TOKEN`. */
  token?: string;
  /** Project slug. Optional — a service token already implies it. Defaults to `$DOPPLER_PROJECT`. */
  project?: string;
  /** Config name. Optional — a service token already implies it. Defaults to `$DOPPLER_CONFIG`. */
  config?: string;
  /** API base. Defaults to `$DOPPLER_API` or `https://api.doppler.com`. */
  apiBase?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * `doppler` store — fetches each secret by NAME (`ref.key ?? ref.name`) from the
 * Doppler API with a service-token Bearer header. Fails closed on
 * auth/transport/missing-value errors.
 */
export function dopplerSecretStore(options: DopplerStoreOptions = {}): SecretStore {
  const env = options.env ?? process.env;
  const token = options.token ?? env.DOPPLER_TOKEN;
  const project = options.project ?? env.DOPPLER_PROJECT;
  const config = options.config ?? env.DOPPLER_CONFIG;
  const apiBase = trimTrailingSlash(options.apiBase ?? env.DOPPLER_API ?? 'https://api.doppler.com');
  const doFetch = options.fetchImpl ?? fetch;
  return {
    source: 'doppler',
    async resolve(refs) {
      if (!token) throw new SecretResolutionError('*', 'doppler', 'DOPPLER_TOKEN is not configured');
      const out: ResolvedSecret[] = [];
      for (const ref of refs) {
        const name = ref.key ?? ref.name;
        const params = new URLSearchParams({ name });
        if (project) params.set('project', project);
        if (config) params.set('config', config);
        const url = `${apiBase}/v3/configs/config/secret?${params.toString()}`;
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }).catch((cause: unknown) => {
          throw new SecretResolutionError(
            ref.name,
            'doppler',
            `request to Doppler failed: ${errMessage(cause)}`,
          );
        });
        if (!res.ok) {
          throw new SecretResolutionError(
            ref.name,
            'doppler',
            `Doppler returned HTTP ${res.status} for ${name}`,
          );
        }
        const value = readDopplerValue((await res.json()) as unknown);
        if (value === undefined) {
          throw new SecretResolutionError(
            ref.name,
            'doppler',
            `no value field in the Doppler response for ${name}`,
          );
        }
        out.push({ name: ref.name, value, source: 'doppler' });
      }
      return out;
    },
  };
}

/**
 * `oidc` store — looper performs no cloud-specific token exchange itself. Run
 * your cloud's official OIDC exchange action in the worker job to mint a
 * short-lived credential, expose it as an env var, and read it via the
 * `actions` store. Resolving here always fails closed with that guidance.
 */
export function oidcSecretStore(): SecretStore {
  return {
    source: 'oidc',
    resolve(refs) {
      const names = refs.map((r) => r.name).join(', ') || 'your secrets';
      return Promise.reject(
        new SecretResolutionError(
          refs[0]?.name ?? '*',
          'oidc',
          `looper does not perform cloud-specific OIDC exchanges. Run your cloud's OIDC ` +
            `token-exchange action in the worker job to mint short-lived credentials for ` +
            `${names}, expose them as env vars, and resolve them with store: actions`,
        ),
      );
    },
  };
}

/** Options accepted by {@link createSecretStore}. */
export interface CreateSecretStoreOptions {
  /** Process env override (applies to every store). */
  env?: NodeJS.ProcessEnv;
  /** Extra options for the `vault` store. */
  vault?: VaultStoreOptions;
  /** Extra options for the `doppler` store. */
  doppler?: DopplerStoreOptions;
}

/**
 * Build the {@link SecretStore} selected by `secrets.store` (self-hosted only).
 * An unknown source fails closed rather than silently resolving nothing.
 */
export function createSecretStore(
  source: SecretSource,
  options: CreateSecretStoreOptions = {},
): SecretStore {
  switch (source) {
    case 'actions':
      return actionsSecretStore(options.env);
    case 'vault': {
      const opts: VaultStoreOptions = { ...options.vault };
      if (options.env !== undefined) opts.env = options.env;
      return vaultSecretStore(opts);
    }
    case 'doppler': {
      const opts: DopplerStoreOptions = { ...options.doppler };
      if (options.env !== undefined) opts.env = options.env;
      return dopplerSecretStore(opts);
    }
    case 'oidc':
      return oidcSecretStore();
    default:
      throw new SecretResolutionError('*', source, `unknown secret store "${String(source)}"`);
  }
}

// --- internal helpers (no secret values are logged) ---------------------------

function splitPathField(key: string): [string, string | undefined] {
  const hash = key.indexOf('#');
  return hash === -1 ? [key, undefined] : [key.slice(0, hash), key.slice(hash + 1)];
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function errMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Vault KV-v2 nests the secret map under `data.data`. */
function readNestedData(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  const outer = body['data'];
  if (!isRecord(outer)) return {};
  const inner = outer['data'];
  return isRecord(inner) ? inner : {};
}

/** Pick a string field: the preferred name, else a sole string field, else `value`. */
function pickField(data: Record<string, unknown>, preferred: string): string | undefined {
  const direct = data[preferred];
  if (typeof direct === 'string') return direct;
  const stringEntries = Object.entries(data).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  );
  const sole = stringEntries.length === 1 ? stringEntries[0] : undefined;
  if (sole) return sole[1];
  const fallback = data['value'];
  return typeof fallback === 'string' ? fallback : undefined;
}

/** Doppler returns `{ name, value: { raw, computed } }` (or a bare string). Prefer computed. */
function readDopplerValue(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const value = body['value'];
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    if (typeof value['computed'] === 'string') return value['computed'];
    if (typeof value['raw'] === 'string') return value['raw'];
  }
  return undefined;
}
