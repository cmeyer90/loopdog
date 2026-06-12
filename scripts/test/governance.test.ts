import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('branch protection config (task 0004)', () => {
  const bp = parse(readFileSync(join(root, '.github/branch-protection.yml'), 'utf8'));

  it('declares the documented protection rules for main', () => {
    expect(bp.branch).toBe('main');
    expect(bp.enforce_admins).toBe(true);
    expect(bp.required_linear_history).toBe(true);
    expect(bp.allow_force_pushes).toBe(false);
    expect(bp.allow_deletions).toBe(false);
    expect(bp.required_conversation_resolution).toBe(true);
    expect(bp.required_pull_request_reviews.required_approving_review_count).toBeGreaterThanOrEqual(
      1,
    );
    expect(bp.required_pull_request_reviews.require_code_owner_reviews).toBe(true);
  });

  it('requires only contexts that exist as ci.yml jobs (lockout guard)', () => {
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const jobs = [...ci.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);
    for (const ctx of bp.required_status_checks.contexts) {
      expect(jobs, `required context '${ctx}' must be a ci.yml job`).toContain(ctx);
    }
    expect(bp.required_status_checks.contexts).toEqual(
      expect.arrayContaining(['lint', 'test', 'build']),
    );
  });
});

describe('CODEOWNERS (task 0004)', () => {
  it('owns every high-blast-radius path', () => {
    const owners = readFileSync(join(root, '.github/CODEOWNERS'), 'utf8');
    for (const path of [
      '/.github/workflows/',
      '/.github/CODEOWNERS',
      '/.github/branch-protection.yml',
      '/templates/workflows/',
      '/packages/github/src/identity/',
      '/packages/runtime/src/loops-builtin/',
      '/AGENTS.md',
      '/.agent/',
    ]) {
      expect(owners, `CODEOWNERS must own ${path}`).toContain(path);
    }
  });
});

describe('release configuration (task 0005)', () => {
  it('keeps all @looper/* packages on one fixed version line', () => {
    const cfg = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'));
    expect(cfg.fixed).toEqual([['@looper/*']]);
    expect(cfg.access).toBe('public');
    expect(cfg.baseBranch).toBe('main');
  });

  it('publishes only @looper/cli; every other package is private', () => {
    const packages = [
      'core',
      'config',
      'github',
      'plans',
      'backends',
      'adapters',
      'runtime',
      'testing',
    ];
    for (const name of packages) {
      const pkg = JSON.parse(readFileSync(join(root, `packages/${name}/package.json`), 'utf8'));
      expect(pkg.private, `@looper/${name} must be private`).toBe(true);
    }
    const cli = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
    expect(cli.private).toBeFalsy();
    expect(cli.bin?.looper).toBeTruthy();
    // @looper/* deps of the CLI are bundled at publish; they must not appear as
    // installable dependencies of the published artifact.
    expect(Object.keys(cli.dependencies ?? {}).filter((d) => d.startsWith('@looper/'))).toEqual([]);
  });
});

describe('trust-boundary doc (task 0032)', () => {
  const doc = readFileSync(join(root, 'docs/trust-boundary.md'), 'utf8');

  it('carries the residency matrix rows and per-backend columns', () => {
    for (const needle of [
      '| Secret class | Claude cloud | Codex cloud | Self-hosted |',
      'Looper repo identity',
      'Provider subscription auth',
      'Model API key',
      'Project build/test/deploy secrets',
      'stripped before the agent phase',
      'LOOPER_CLAUDE_FIRE_URL',
      'LOOPER_MODEL_API_KEY',
    ]) {
      expect(doc, needle).toContain(needle);
    }
  });

  it('states the Codex consequence and the rung-2 rule plainly', () => {
    expect(doc).toContain('tests needing live credentials or network may not');
    expect(doc).toContain('regardless of');
    expect(doc).toContain('ladder rung 2');
  });

  it('matches the workflows: no looper GitHub App, least-privilege manifest', () => {
    expect(doc).toContain('No looper GitHub App');
    for (const wf of ['reusable-events.yml', 'reusable-sweep.yml']) {
      const parsed = parse(readFileSync(join(root, `.github/workflows/${wf}`), 'utf8')) as {
        permissions: Record<string, string>;
      };
      expect(parsed.permissions, wf).toEqual({
        contents: 'write',
        issues: 'write',
        'pull-requests': 'write',
        checks: 'read',
      });
    }
  });
});
