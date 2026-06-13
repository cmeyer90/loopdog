import { describe, expect, it } from 'vitest';
import {
  SecretResolutionError,
  actionsSecretStore,
  createSecretStore,
  dopplerSecretStore,
  oidcSecretStore,
  vaultSecretStore,
} from '@looper/backends';

/** A fetch stub that ignores its args and returns a fixed JSON payload. */
const fakeFetch = (payload: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch =>
  (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => payload,
    }) as unknown as Response) as unknown as typeof fetch;

describe('actions secret store', () => {
  it('resolves names (and key overrides) from the worker env', async () => {
    const store = actionsSecretStore({ NPM_TOKEN: 'npm-xxx', DB: 'postgres://x' });
    const out = await store.resolve([{ name: 'NPM_TOKEN' }, { name: 'DATABASE_URL', key: 'DB' }]);
    expect(out).toEqual([
      { name: 'NPM_TOKEN', value: 'npm-xxx', source: 'actions' },
      { name: 'DATABASE_URL', value: 'postgres://x', source: 'actions' },
    ]);
  });

  it('fails closed when a secret is absent from the env', async () => {
    const store = actionsSecretStore({});
    await expect(store.resolve([{ name: 'MISSING' }])).rejects.toBeInstanceOf(
      SecretResolutionError,
    );
  });
});

describe('vault secret store', () => {
  it('reads a KV-v2 field with the token header and path#field syntax', async () => {
    let seenUrl = '';
    let seenToken: string | undefined;
    const fetchImpl = ((url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = url;
      seenToken = init?.headers?.['X-Vault-Token'];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { data: { url: 'postgres://db' } } }),
      } as unknown as Response);
    }) as unknown as typeof fetch;
    const store = vaultSecretStore({
      address: 'https://vault.example.com/',
      token: 'vault-tok',
      fetchImpl,
    });
    const out = await store.resolve([{ name: 'DATABASE_URL', key: 'ci/db#url' }]);
    expect(out).toEqual([{ name: 'DATABASE_URL', value: 'postgres://db', source: 'vault' }]);
    expect(seenUrl).toBe('https://vault.example.com/v1/secret/data/ci/db');
    expect(seenToken).toBe('vault-tok');
  });

  it('fails closed on a non-OK Vault response', async () => {
    const store = vaultSecretStore({
      address: 'https://v',
      token: 't',
      fetchImpl: fakeFetch({}, { ok: false, status: 403 }),
    });
    await expect(store.resolve([{ name: 'X', key: 'p' }])).rejects.toBeInstanceOf(
      SecretResolutionError,
    );
  });

  it('fails closed when address/token are not configured', async () => {
    const store = vaultSecretStore({ env: {} });
    await expect(store.resolve([{ name: 'X' }])).rejects.toBeInstanceOf(SecretResolutionError);
  });
});

describe('doppler secret store', () => {
  it('fetches by name with a bearer token and prefers value.computed', async () => {
    let seenAuth: string | undefined;
    const fetchImpl = ((_url: string, init?: { headers?: Record<string, string> }) => {
      seenAuth = init?.headers?.['Authorization'];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ name: 'API_KEY', value: { raw: 'r', computed: 'c' } }),
      } as unknown as Response);
    }) as unknown as typeof fetch;
    const store = dopplerSecretStore({ token: 'dp.tok', fetchImpl });
    const out = await store.resolve([{ name: 'API_KEY' }]);
    expect(out).toEqual([{ name: 'API_KEY', value: 'c', source: 'doppler' }]);
    expect(seenAuth).toBe('Bearer dp.tok');
  });
});

describe('oidc secret store', () => {
  it('always fails closed with exchange guidance (points at the actions store)', async () => {
    await expect(oidcSecretStore().resolve([{ name: 'AWS' }])).rejects.toThrow(/actions/);
  });
});

describe('createSecretStore', () => {
  it('selects the store by source and rejects an unknown store', () => {
    expect(createSecretStore('actions').source).toBe('actions');
    expect(createSecretStore('vault').source).toBe('vault');
    expect(createSecretStore('doppler').source).toBe('doppler');
    expect(createSecretStore('oidc').source).toBe('oidc');
    expect(() => createSecretStore('nope' as never)).toThrow(SecretResolutionError);
  });
});
