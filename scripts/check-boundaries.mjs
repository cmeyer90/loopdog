// Enforces the package dependency direction from docs/codebase.md.
// Fails (exit 1) on: an import edge not in the allowed table, or any deep
// import into another package's internals ('@loopdog/<name>/...').
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = {
  core: [],
  config: ['core'],
  github: ['core'],
  plans: ['core', 'github'],
  backends: ['core', 'github'],
  adapters: ['core'],
  runtime: ['core', 'config', 'github', 'plans', 'backends', 'adapters'],
  cli: ['core', 'config', 'github', 'runtime'],
  testing: ['core', 'config', 'runtime'],
};

const root = new URL('..', import.meta.url).pathname;
const violations = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(p, files);
    } else if (/\.(ts|mts|cts|tsx|js|mjs)$/.test(entry)) {
      files.push(p);
    }
  }
  return files;
}

for (const pkg of Object.keys(ALLOWED)) {
  const srcDir = join(root, 'packages', pkg, 'src');
  let files = [];
  try {
    files = walk(srcDir);
  } catch {
    continue; // package not created yet
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const importRe =
      /from\s+['"](@loopdog\/[^'"]+)['"]|import\(\s*['"](@loopdog\/[^'"]+)['"]\s*\)/g;
    for (const m of text.matchAll(importRe)) {
      const spec = m[1] ?? m[2];
      const rel = file.slice(root.length);
      const parts = spec.split('/');
      const target = parts[1];
      if (parts.length > 2) {
        violations.push(`${rel}: deep import '${spec}' (use the '@loopdog/${target}' barrel)`);
        continue;
      }
      if (target === pkg) {
        violations.push(`${rel}: package imports its own barrel ('${spec}')`);
        continue;
      }
      if (!ALLOWED[pkg].includes(target)) {
        violations.push(
          `${rel}: '${pkg}' may not depend on '${target}' (allowed: ${ALLOWED[pkg].join(', ') || 'none'})`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Package boundary violations:\n' + violations.map((v) => `  - ${v}`).join('\n'));
  process.exit(1);
}
console.log('package boundaries OK');
