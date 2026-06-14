import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteStoredToken, readStoredToken, storeToken } from '../src/auth/token-store.js';

let dirs: string[] = [];
async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loopdog-home-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('token store (0077)', () => {
  it('file fallback writes 0600 ~/.loopdog/auth.json and round-trips', async () => {
    const dir = await home();
    const where = await storeToken('tok-secret-123', 'github', { home: dir });
    expect(where).toBe('file');
    const file = join(dir, '.loopdog', 'auth.json');
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readStoredToken({ home: dir })).toBe('tok-secret-123');
  });

  it('logout removes the token idempotently', async () => {
    const dir = await home();
    await storeToken('tok', 'github', { home: dir });
    await deleteStoredToken({ home: dir });
    expect(await readStoredToken({ home: dir })).toBeNull();
    await deleteStoredToken({ home: dir }); // second call: no throw
  });

  it('never stores the token anywhere but the auth file (no repo-relative writes)', async () => {
    const dir = await home();
    await storeToken('tok-abc', 'github', { home: dir });
    const written = await readFile(join(dir, '.loopdog', 'auth.json'), 'utf8');
    expect(written).toContain('tok-abc');
    // the only artifact is under the (test) home dir — nothing in cwd
    await expect(stat(join(process.cwd(), '.loopdog', 'auth.json'))).rejects.toThrow();
  });
});
