import { describe, expect, it } from 'vitest';
import { handleEvent } from '@looper/runtime';
import type { ControllerOptions } from '@looper/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@looper/testing';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScaffoldPlan } from '../../cli/src/commands/init.js';
import { renderCriteriaBlock, stateLabel } from '@looper/core';

/**
 * Authorization & trigger control (M17): untrusted triggers on a public repo
 * are parked (needs-approval) and never dispatch; only a trusted human's
 * approval releases them — proven end-to-end through the controller on fakes.
 */
const repo = { owner: 'o', repo: 'r' };
const ref = { ...repo, number: 1 };
const dirs: string[] = [];

async function scaffoldActRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'looper-authz-'));
  dirs.push(dir);
  const templatesDir = fileURLToPath(new URL('../../../templates/', import.meta.url));
  const plan = await buildScaffoldPlan(templatesDir, dir);
  for (const file of plan.files) {
    const target = join(dir, file.path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await readFile(file.source, 'utf8'));
  }
  const rootYml = join(dir, '.looper', 'looper.yml');
  await writeFile(rootYml, (await readFile(rootYml, 'utf8')).replace('mode: dry-run', 'mode: act'));
  return dir;
}

function makeWorld(repoDir: string) {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const opts: ControllerOptions = {
    repoDir,
    repo,
    gh,
    backends: new Map([['claude', backend]]),
    records: new InMemoryRunRecordStore(),
    botLogin: 'github-actions[bot]',
  };
  return { gh, backend, opts };
}

const GROOMED = [
  'Body.',
  renderCriteriaBlock([
    { text: 'works', validation: { kind: 'test', ref: 'a.test.ts' }, met: false },
  ]),
  '<!-- looper:scope -->bounded<!-- /looper:scope -->',
].join('\n');

describe('authorization gate (M17, public-repo safe-by-default)', () => {
  it('parks an untrusted trigger (needs-approval, no dispatch); a trusted approval releases it', async () => {
    const repoDir = await scaffoldActRepo();
    const { gh, backend, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    // a ready issue whose implement-loop trigger comes from an untrusted (NONE) actor
    gh.seedIssue({ ref, body: GROOMED, labels: [stateLabel('ready-for-agent')] });

    const untrusted = await handleEvent(opts, 'issues', {
      action: 'labeled',
      issue: { number: 1, author_association: 'NONE' },
      label: { name: stateLabel('ready-for-agent') },
      sender: { login: 'stranger', type: 'User' },
    });
    expect(backend.dispatched).toEqual([]); // never spent
    const parked = await gh.getIssue(ref);
    expect(parked.labels).toContain('looper:needs-approval');
    expect(untrusted.records.some((r) => r.outcome.status === 'parked')).toBe(true);

    // an UNTRUSTED self-approval does NOT release it
    await gh.addLabels(ref, ['looper:approved']);
    await handleEvent(opts, 'issues', {
      action: 'labeled',
      issue: { number: 1, author_association: 'NONE' },
      label: { name: 'looper:approved' },
      sender: { login: 'stranger', type: 'User' },
    });
    expect((await gh.getIssue(ref)).labels).not.toContain('looper:approved'); // revoked
    expect(backend.dispatched).toEqual([]);

    // a TRUSTED collaborator applies looper:approved — the label event both
    // releases the hold AND re-runs the loop, which now dispatches.
    await gh.addLabels(ref, ['looper:approved']);
    const released = await handleEvent(opts, 'issues', {
      action: 'labeled',
      issue: { number: 1, author_association: 'COLLABORATOR' },
      label: { name: 'looper:approved' },
      sender: { login: 'dana', type: 'User' },
    });
    expect((await gh.getIssue(ref)).labels).toContain('looper:approved'); // stuck (trusted)
    expect(backend.dispatched).toHaveLength(1); // released → dispatched
    expect(released.records.some((r) => r.outcome.status === 'pending')).toBe(true);
  });

  it('a trusted collaborator trigger dispatches immediately (no park)', async () => {
    const repoDir = await scaffoldActRepo();
    const { gh, backend, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    gh.seedIssue({ ref, body: GROOMED, labels: [stateLabel('ready-for-agent')] });
    await handleEvent(opts, 'issues', {
      action: 'labeled',
      issue: { number: 1, author_association: 'OWNER' },
      label: { name: stateLabel('ready-for-agent') },
      sender: { login: 'owner', type: 'User' },
    });
    expect(backend.dispatched).toHaveLength(1);
    expect((await gh.getIssue(ref)).labels).not.toContain('looper:needs-approval');
  });
});

import { afterAll } from 'vitest';
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});
