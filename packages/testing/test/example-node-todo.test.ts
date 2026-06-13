import { afterAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@looper/config';
import { stateLabel } from '@looper/core';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore, VirtualClock } from '@looper/testing';
import { assertGolden, runScenario, type ScenarioWorld } from '@looper/testing';
import type { ControllerOptions } from '@looper/runtime';

/**
 * The runnable example attachment (M14 · 0061): the committed
 * `examples/node-todo/` config validates against the real schema and drives the
 * built-in loops through the REAL controller on fakes — the executable proof the
 * Quickstart works, offline and zero-quota. Doubles as a dogfood + fork template.
 */

const EXAMPLE = fileURLToPath(new URL('../../../examples/node-todo/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/goldens/', import.meta.url));
const repo = { owner: 'acme', repo: 'node-todo' };
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const GROOMED = [
  'Add a `clear()` method that removes all completed todos.',
  '<!-- looper:acceptance-criteria -->',
  '- [ ] clear() removes done items, keeps open ones (test: test/todo.test.js)',
  '<!-- /looper:acceptance-criteria -->',
  '<!-- looper:scope -->src/todo.js only<!-- /looper:scope -->',
].join('\n');

describe('example attachment: node-todo (0061)', () => {
  it('the committed example config validates against the @looper/config schema', async () => {
    const result = await loadConfig(EXAMPLE);
    expect(result.ok).toBe(true);
    // It ships SAFE: dry-run by default (the maintainer promotes per loop).
    const root = await readFile(join(EXAMPLE, '.looper', 'looper.yml'), 'utf8');
    expect(root).toMatch(/mode:\s*dry-run/);
    // And references no API key / PAT anywhere in the attachment.
    expect(root).not.toMatch(/ghp_|sk-ant-|api[_-]?key/i);
  });

  it('drives node-todo through groom→implement on fakes to a golden (act for the trace)', async () => {
    // Copy the example attachment and promote to act so the trace shows effects.
    const dir = await mkdtemp(join(tmpdir(), 'looper-example-'));
    dirs.push(dir);
    await cp(join(EXAMPLE, '.looper'), join(dir, '.looper'), { recursive: true });
    const rootYml = join(dir, '.looper', 'looper.yml');
    await writeFile(
      rootYml,
      (await readFile(rootYml, 'utf8')).replace('mode: dry-run', 'mode: act'),
    );

    const gh = new FakeGitHub();
    const backend = new FakeBackend(gh, { id: 'claude' });
    const records = new InMemoryRunRecordStore();
    const clock = new VirtualClock();
    const opts: ControllerOptions = {
      repoDir: dir,
      repo,
      gh,
      backends: new Map([['claude', backend]]),
      records,
      botLogin: 'github-actions[bot]',
      now: clock.now,
    };
    const world: ScenarioWorld = { opts, gh, records, clock };

    const result = await runScenario(world, {
      name: 'node-todo',
      initial: {
        issues: [
          {
            ref: { number: 42 },
            title: 'Add TodoList.clear()',
            body: GROOMED,
            labels: [stateLabel('ready-for-agent')],
            author: { login: 'maintainer', type: 'User' },
          },
        ],
      },
      steps: [{ sweep: {} }, { sweep: {} }], // dispatch implement → ingest the PR
    });

    expect(result.golden.labels['42']).toContain(stateLabel('in-review'));
    expect(result.golden.prs).toHaveLength(1);
    expect(result.golden.prs[0]!.linksIssue).toBe(42);
    await assertGolden(result, 'example-node-todo', { dir: GOLDEN_DIR });
  });
});
