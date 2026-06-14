import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Locates the shipped `templates/` tree (task 0007). In the published package
 * the bundle step copies it into `dist/templates`; in the dev workspace it is
 * the repo-root `templates/`. A missing tree is a packaging bug — hard error.
 */
export async function findTemplatesDir(): Promise<string> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    join(here, 'templates'), // published: dist/templates
    join(here, '..', '..', '..', 'templates'), // dev: packages/cli/dist -> repo root
    join(here, '..', '..', '..', '..', 'templates'), // dev via src (vitest alias)
  ];
  for (const dir of candidates) {
    try {
      await access(join(dir, 'loopdog.yml'));
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(
    'loopdog templates not found — this is a packaging bug (expected dist/templates in the published package)',
  );
}
