import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * Config discovery (task 0006): the root `.loopdog/loopdog.yml` plus one folder
 * per loop under `.loopdog/loops/<name>/` (`loop.yml` + sibling `prompt.md`).
 * Discovery only READS and parses YAML; schema + cross-field validation is
 * `validate.ts`. No loop config is ever read from a monolithic file.
 */

export interface DiscoveredTree {
  /** Repo root the tree was discovered from. */
  rootDir: string;
  rootFile: string;
  /** Parsed-but-unvalidated YAML (null = file missing). */
  root: unknown | null;
  loops: DiscoveredLoop[];
}

export interface DiscoveredLoop {
  /** Folder name under `.loopdog/loops/`. */
  folder: string;
  file: string;
  raw: unknown | null;
  promptPath: string;
  promptExists: boolean;
  /** YAML parse error, if any (surfaced as a validation error). */
  parseError?: string;
}

export const LOOPDOG_DIR = '.loopdog';

export async function discoverConfig(repoDir: string): Promise<DiscoveredTree> {
  const rootFile = join(repoDir, LOOPDOG_DIR, 'loopdog.yml');
  let root: unknown | null = null;
  try {
    root = parse(await readFile(rootFile, 'utf8'));
  } catch {
    root = null;
  }

  const loopsDir = join(repoDir, LOOPDOG_DIR, 'loops');
  const loops: DiscoveredLoop[] = [];
  let folders: string[] = [];
  try {
    folders = (await readdir(loopsDir)).sort();
  } catch {
    folders = [];
  }
  for (const folder of folders) {
    const dir = join(loopsDir, folder);
    if (
      !(await stat(dir)
        .then((s) => s.isDirectory())
        .catch(() => false))
    )
      continue;
    const file = join(dir, 'loop.yml');
    const promptPath = join(dir, 'prompt.md');
    const loop: DiscoveredLoop = {
      folder,
      file,
      raw: null,
      promptPath,
      promptExists: await stat(promptPath)
        .then((s) => s.isFile())
        .catch(() => false),
    };
    try {
      loop.raw = parse(await readFile(file, 'utf8'));
    } catch (err) {
      loop.parseError = err instanceof Error ? err.message : String(err);
    }
    loops.push(loop);
  }
  return { rootDir: repoDir, rootFile, root, loops };
}
