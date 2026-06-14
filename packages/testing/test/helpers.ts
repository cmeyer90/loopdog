import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ControllerOptions } from '@loopdog/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore, VirtualClock } from '@loopdog/testing';
import type { ScenarioWorld } from '@loopdog/testing';
import { renderCriteriaBlock } from '@loopdog/core';
// test-only import of the CLI scaffolder (boundary check scans src/ only).
import { buildScaffoldPlan } from '../../cli/src/commands/init.js';

export const repo = { owner: 'o', repo: 'r' };
const dirs: string[] = [];

export async function cleanup(): Promise<void> {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
}

/** Scaffold a real loopdog repo on disk (act mode) from the shipped templates. */
export async function scaffoldActRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loopdog-m18-'));
  dirs.push(dir);
  const templatesDir = fileURLToPath(new URL('../../../templates/', import.meta.url));
  const plan = await buildScaffoldPlan(templatesDir, dir);
  for (const file of plan.files) {
    const target = join(dir, file.path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await readFile(file.source, 'utf8'));
  }
  const rootYml = join(dir, '.loopdog', 'loopdog.yml');
  await writeFile(rootYml, (await readFile(rootYml, 'utf8')).replace('mode: dry-run', 'mode: act'));
  return dir;
}

export interface World extends ScenarioWorld {
  backend: FakeBackend;
}

export function makeWorld(repoDir: string, opts: { clockStart?: string } = {}): World {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const records = new InMemoryRunRecordStore();
  const clock = new VirtualClock(opts.clockStart);
  // Deterministic-but-unique claimant nonce: a monotonic counter keeps racing
  // invocations distinct (the double-dispatch defense) without Math.random.
  let nonce = 0;
  const controller: ControllerOptions = {
    repoDir,
    repo,
    gh,
    backends: new Map([['claude', backend]]),
    records,
    botLogin: 'github-actions[bot]',
    now: clock.now,
    claimNonce: () => `n${nonce++}`,
  };
  return { opts: controller, gh, records, clock, backend };
}

/** A groomed issue body: acceptance criteria block + a bounded scope marker. */
export const GROOMED_BODY = [
  'Please add rate limiting to the public API.',
  renderCriteriaBlock([
    { text: 'rate limit enforced', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
  ]),
  '<!-- loopdog:scope -->api/ratelimit only<!-- /loopdog:scope -->',
].join('\n');
