import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCronDue, loadConfig, validateCron } from '@looper/config';

const ROOT_YML = `
version: 1
backends: { default: claude }
defaults:
  blast_radius: { max_files: 20, max_diff: 400 }
  mode: dry-run
`;

const IMPLEMENT_YML = `
name: implement
trigger:
  github_event: issues
  action: [labeled]
transition: { from: ready-for-agent, to: in-review }
expects: pull-request
gates: { require_dor: true, require_ci: true, tier: default }
blast_radius: { max_files: 5 }
mode: act
`;

let dirs: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'looper-config-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('config discovery + validation (0006)', () => {
  it('validates and resolves a good tree, merging root defaults', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/implement/loop.yml': IMPLEMENT_YML,
      '.looper/loops/implement/prompt.md': 'You are the implementation work cell.',
      '.looper/loops/groom/loop.yml': `
name: groom
trigger: { github_event: issues, action: [opened] }
transition: { from: needs-grooming, to: ready-for-agent }
expects: plan-update
gates: { require_dor: false }
`,
      '.looper/loops/groom/prompt.md': 'You are the grooming work cell.',
    });
    const result = await loadConfig(dir);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    const implement = result.config!.loops.find((l) => l.name === 'implement')!;
    expect(implement.mode).toBe('act'); // per-loop override
    expect(implement.backend).toBe('claude'); // root default
    expect(implement.blastRadius?.maxFiles).toBe(5); // per-loop override
    expect(implement.blastRadius?.maxDiffLines).toBe(400); // root default
    expect(implement.expects).toBe('pull-request');
    expect(implement.trigger).toEqual({ kind: 'github_event', events: ['issues.labeled'] });

    const groom = result.config!.loops.find((l) => l.name === 'groom')!;
    expect(groom.mode).toBe('dry-run'); // root default (safe by default)
    // groom legitimately skips DoR (it CREATES the DoR) — no warning for
    // non-PR work cells; a PR loop without DoR does warn:
    expect(result.warnings.some((w) => w.path === 'gates.require_dor')).toBe(false);

    // no monolithic source: each loop came from its own folder
    expect(result.config!.loopConfigs.size).toBe(2);
  });

  it('rejects events/actions outside the canonical matrix', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/bad/loop.yml': `
name: bad
trigger: { github_event: label, action: [labeled] }
transition: { from: new, to: needs-grooming }
`,
      '.looper/loops/bad/prompt.md': 'x',
      '.looper/loops/worse/loop.yml': `
name: worse
trigger: { github_event: push }
transition: { from: new, to: needs-grooming }
`,
      '.looper/loops/worse/prompt.md': 'x',
    });
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    const messages = result.errors.map((e) => e.message).join('\n');
    expect(messages).toContain("'label.labeled' is not in the V1 event/action matrix");
    expect(messages).toContain("'push' is not in the V1 event/action matrix");
  });

  it('rejects an illegal transition with the table reason', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/jump/loop.yml': `
name: jump
trigger: { github_event: issues, action: [opened] }
transition: { from: new, to: merged }
`,
      '.looper/loops/jump/prompt.md': 'x',
    });
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.path).toBe('transition');
    expect(result.errors[0]!.message).toContain("no legal edge 'new -> merged'");
  });

  it('accepts custom states/edges via declares (custom loops, 0011)', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/security/loop.yml': `
name: security
trigger: { github_event: pull_request, action: [opened] }
transition: { from: in-review, to: security-review }
declares:
  states: [security-review]
  edges: [{ from: in-review, to: security-review, by: security }]
`,
      '.looper/loops/security/prompt.md': 'x',
    });
    const result = await loadConfig(dir);
    expect(result.errors).toEqual([]);
    expect(result.config!.table.states).toContain('security-review');
  });

  it('requires prompt.md, folder-name match, unique names, one trigger kind', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/a/loop.yml': `
name: not-a
trigger: { github_event: issues, action: [opened], cron: daily }
transition: { from: new, to: needs-grooming }
`,
    });
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    const messages = result.errors.map((e) => e.message).join('\n');
    expect(messages).toContain('exactly one trigger kind');
    // name/prompt checks only run on schema-valid loops — fix trigger, recheck
    const dir2 = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/a/loop.yml': `
name: not-a
trigger: { github_event: issues, action: [opened] }
transition: { from: new, to: needs-grooming }
`,
    });
    const result2 = await loadConfig(dir2);
    const messages2 = result2.errors.map((e) => e.message).join('\n');
    expect(messages2).toContain("must equal the folder name 'a'");
    expect(messages2).toContain('prompt.md is required');
  });

  it('rejects unsupported cron expressions with guidance', async () => {
    const dir = await tree({
      '.looper/looper.yml': ROOT_YML,
      '.looper/loops/dep/loop.yml': `
name: dep
trigger: { cron: "1-5 * * * *" }
transition: { from: scheduled, to: in-review }
expects: pull-request
`,
      '.looper/loops/dep/prompt.md': 'x',
    });
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.path).toBe('trigger.cron');
  });

  it('fails closed on a missing root file with a pointer to looper init', async () => {
    const dir = await tree({});
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toContain('looper init');
  });
});

describe('cron support (0006/0076)', () => {
  it('validates the supported shapes and rejects the rest', () => {
    for (const good of ['hourly', 'daily', 'weekly', '*/5 * * * *', '0 9 * * *', '30 6 * * 1']) {
      expect(validateCron(good).ok, good).toBe(true);
    }
    for (const bad of ['1-5 * * * *', '* * 1 * *', 'every tuesday', '0 9 * 2 *']) {
      expect(validateCron(bad).ok, bad).toBe(false);
    }
  });

  it('computes due-ness within the sweep window (missed ticks coalesce)', () => {
    const now = new Date('2026-06-09T12:04:30Z');
    expect(isCronDue('*/5 * * * *', now, 5)).toBe(true); // 12:00 fire in window
    expect(isCronDue('hourly', now, 5)).toBe(true); // 12:00
    expect(isCronDue('hourly', new Date('2026-06-09T12:30:00Z'), 5)).toBe(false);
    expect(isCronDue('daily', new Date('2026-06-09T00:02:00Z'), 5)).toBe(true);
    expect(isCronDue('weekly', new Date('2026-06-08T00:03:00Z'), 5)).toBe(true); // Mon 00:00
    expect(isCronDue('weekly', new Date('2026-06-09T00:03:00Z'), 5)).toBe(false); // Tue
    // a 30-minute outage window still catches the missed daily fire
    expect(isCronDue('daily', new Date('2026-06-09T00:25:00Z'), 30)).toBe(true);
  });
});
