import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Local token storage for `looper login` (task 0077): the OS keychain
 * (service `looper`) when available — macOS `security`, Linux `secret-tool` —
 * else a 0600 `~/.looper/auth.json` with a printed plaintext warning. Never
 * written into any repo or model-visible artifact.
 */

const SERVICE = 'looper';

export interface TokenStoreOptions {
  /** Override for tests; defaults to the user home dir. */
  home?: string;
  /** Override for tests; defaults to process.platform. */
  platform?: NodeJS.Platform;
}

function authFile(opts: TokenStoreOptions): string {
  return join(opts.home ?? homedir(), '.looper', 'auth.json');
}

export async function storeToken(
  token: string,
  account: string,
  opts: TokenStoreOptions = {},
): Promise<'keychain' | 'file'> {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin' && !opts.home) {
    try {
      await execFileAsync('security', [
        'add-generic-password',
        '-U',
        '-s',
        SERVICE,
        '-a',
        account,
        '-w',
        token,
      ]);
      return 'keychain';
    } catch {
      // fall through to file
    }
  }
  if (platform === 'linux' && !opts.home) {
    try {
      const child = execFile('secret-tool', [
        'store',
        '--label',
        SERVICE,
        'service',
        SERVICE,
        'account',
        account,
      ]);
      child.stdin?.write(token);
      child.stdin?.end();
      await new Promise<void>((resolve, reject) => {
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`secret-tool exit ${code}`)),
        );
        child.on('error', reject);
      });
      return 'keychain';
    } catch {
      // fall through to file
    }
  }
  const file = authFile(opts);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ account, token }) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
  return 'file';
}

export async function readStoredToken(opts: TokenStoreOptions = {}): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin' && !opts.home) {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        SERVICE,
        '-w',
      ]);
      const token = stdout.trim();
      if (token) return token;
    } catch {
      // not in keychain
    }
  }
  if (platform === 'linux' && !opts.home) {
    try {
      const { stdout } = await execFileAsync('secret-tool', ['lookup', 'service', SERVICE]);
      const token = stdout.trim();
      if (token) return token;
    } catch {
      // not in keychain
    }
  }
  try {
    const parsed = JSON.parse(await readFile(authFile(opts), 'utf8')) as { token?: string };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

/** Remove the stored token everywhere. Idempotent. */
export async function deleteStoredToken(opts: TokenStoreOptions = {}): Promise<void> {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin' && !opts.home) {
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', SERVICE]);
    } catch {
      // absent — fine
    }
  }
  if (platform === 'linux' && !opts.home) {
    try {
      await execFileAsync('secret-tool', ['clear', 'service', SERVICE]);
    } catch {
      // absent — fine
    }
  }
  await rm(authFile(opts), { force: true });
}
