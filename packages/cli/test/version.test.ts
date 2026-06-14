import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the bundling crash: `src/commands/*.ts` read the CLI
 * version via `require('../../package.json')`, which is correct in source
 * (depth-2) but resolves one level *above* the installed package once tsup
 * flattens every file into `dist/` — `Cannot find module '../../package.json'`,
 * crashing `loopdog upgrade`/`status`. The version read now lives only in
 * `src/version.ts` (depth-1, bundle-safe). Keep it that way.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await tsFiles(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('CLI version read (bundle-safe)', () => {
  it('reads package.json only from src/version.ts — never from a deeper path', async () => {
    const files = await tsFiles(SRC);
    const readers: string[] = [];
    // match the actual call, e.g. require('../package.json') — not doc comments
    const anyRead = /require\(['"][^'"]*package\.json['"]\)/;
    const depth2Read = /require\(['"][^'"]*\.\.\/\.\.\/[^'"]*package\.json['"]\)/;
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      // the broken depth-2 read must never come back, anywhere
      expect(depth2Read.test(text), `${file} must not require ../../package.json`).toBe(false);
      if (anyRead.test(text)) readers.push(file);
    }
    expect(readers.map((f) => f.slice(SRC.length + 1))).toEqual(['version.ts']);
  });
});
