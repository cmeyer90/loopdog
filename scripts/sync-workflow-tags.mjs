#!/usr/bin/env node
// Sync the workflow-ref git tags that `loopdog init` pins into adopter repos.
//
// On every real publish the release pipeline (.github/workflows/release.yml)
// runs this to (re)point two tags at the release commit:
//   - vX.Y.Z  — the exact release tag
//   - vX      — the floating major tag the scaffold defaults to (`uses: …@vX`)
// so a freshly-scaffolded `uses: …@vX` always resolves and tracks the latest X.x.
//
// This is what keeps a release from ever again leaving `@vX` dangling — there is
// no manual tagging step. The published version is the source of truth.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8'),
);
const exact = `v${version}`;
const major = `v${version.split('.')[0]}`;

const run = (cmd) => execSync(cmd, { stdio: ['ignore', 'inherit', 'inherit'] });

run('git config user.name "github-actions[bot]"');
run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
// -f so a re-run (or a moved floating major) is idempotent rather than a failure.
run(`git tag -f ${exact}`);
run(`git tag -f ${major}`);
run(`git push --force origin refs/tags/${exact} refs/tags/${major}`);

const at = execSync('git rev-parse --short HEAD').toString().trim();
console.log(`synced workflow-ref tags: ${exact} + floating ${major} -> ${at}`);
