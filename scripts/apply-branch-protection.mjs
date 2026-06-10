// Applies .github/branch-protection.yml to the repo's default branch (task 0004).
// Idempotent: PUTs the declared config, then read-back-verifies; exits non-zero
// on drift or on a required-check context that ci.yml does not define.
//
// Auth (admin required): GITHUB_TOKEN or ADMIN_TOKEN env, or `gh auth token`.
// Repo: LOOPER_REPO env (owner/name) or inferred from `git remote get-url origin`.
// Usage: npm run protect [-- --check]   (--check: verify only, never write)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse } from 'yaml';
import { z } from 'zod';

const Schema = z.object({
  branch: z.string().min(1),
  required_status_checks: z.object({
    strict: z.boolean(),
    contexts: z.array(z.string().min(1)).min(1),
  }),
  required_pull_request_reviews: z.object({
    required_approving_review_count: z.number().int().min(1).max(6),
    require_code_owner_reviews: z.boolean(),
    dismiss_stale_reviews: z.boolean(),
  }),
  enforce_admins: z.boolean(),
  required_linear_history: z.boolean(),
  allow_force_pushes: z.boolean(),
  allow_deletions: z.boolean(),
  required_conversation_resolution: z.boolean(),
});

const root = new URL('..', import.meta.url).pathname;
const checkOnly = process.argv.includes('--check');

const file = Schema.parse(parse(readFileSync(`${root}/.github/branch-protection.yml`, 'utf8')));

// Guard: every required context must exist as a job in ci.yml, or merges will
// deadlock on a check that never reports (the lockout failure mode in 0004).
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8');
const ciJobs = [...ci.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);
for (const ctx of file.required_status_checks.contexts) {
  if (!ciJobs.includes(ctx)) {
    console.error(`required context '${ctx}' is not a job in .github/workflows/ci.yml`);
    process.exit(1);
  }
}

function resolveToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('no ADMIN_TOKEN/GITHUB_TOKEN env and `gh auth token` failed');
    process.exit(1);
  }
}

function resolveRepo() {
  if (process.env.LOOPER_REPO) return process.env.LOOPER_REPO;
  const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/.]+?)(?:\.git)?$/);
  if (!m) {
    console.error(`cannot parse owner/name from origin url: ${url}`);
    process.exit(1);
  }
  return m[1];
}

const token = resolveToken();
const repo = resolveRepo();
const api = `https://api.github.com/repos/${repo}/branches/${file.branch}/protection`;
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

const desired = {
  required_status_checks: {
    strict: file.required_status_checks.strict,
    contexts: file.required_status_checks.contexts,
  },
  enforce_admins: file.enforce_admins,
  required_pull_request_reviews: {
    required_approving_review_count:
      file.required_pull_request_reviews.required_approving_review_count,
    require_code_owner_reviews: file.required_pull_request_reviews.require_code_owner_reviews,
    dismiss_stale_reviews: file.required_pull_request_reviews.dismiss_stale_reviews,
  },
  restrictions: null,
  required_linear_history: file.required_linear_history,
  allow_force_pushes: file.allow_force_pushes,
  allow_deletions: file.allow_deletions,
  required_conversation_resolution: file.required_conversation_resolution,
};

if (!checkOnly) {
  const put = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(desired) });
  if (!put.ok) {
    console.error(`PUT ${api} -> ${put.status}: ${await put.text()}`);
    process.exit(1);
  }
  console.log(`applied protection to ${repo}@${file.branch}`);
}

// Read-back verification: live config must match the file.
const get = await fetch(api, { headers });
if (!get.ok) {
  console.error(`GET ${api} -> ${get.status}: ${await get.text()}`);
  process.exit(1);
}
const live = await get.json();
const drift = [];
const want = (path, expected, actual) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    drift.push(`${path}: want ${JSON.stringify(expected)}, live ${JSON.stringify(actual)}`);
  }
};
want(
  'required_status_checks.strict',
  desired.required_status_checks.strict,
  live.required_status_checks?.strict,
);
want(
  'required_status_checks.contexts',
  [...desired.required_status_checks.contexts].sort(),
  [...(live.required_status_checks?.contexts ?? [])].sort(),
);
want('enforce_admins', desired.enforce_admins, live.enforce_admins?.enabled);
want(
  'required_pull_request_reviews.required_approving_review_count',
  desired.required_pull_request_reviews.required_approving_review_count,
  live.required_pull_request_reviews?.required_approving_review_count,
);
want(
  'required_pull_request_reviews.require_code_owner_reviews',
  desired.required_pull_request_reviews.require_code_owner_reviews,
  live.required_pull_request_reviews?.require_code_owner_reviews,
);
want(
  'required_pull_request_reviews.dismiss_stale_reviews',
  desired.required_pull_request_reviews.dismiss_stale_reviews,
  live.required_pull_request_reviews?.dismiss_stale_reviews,
);
want(
  'required_linear_history',
  desired.required_linear_history,
  live.required_linear_history?.enabled,
);
want('allow_force_pushes', desired.allow_force_pushes, live.allow_force_pushes?.enabled);
want('allow_deletions', desired.allow_deletions, live.allow_deletions?.enabled);
want(
  'required_conversation_resolution',
  desired.required_conversation_resolution,
  live.required_conversation_resolution?.enabled,
);

if (drift.length > 0) {
  console.error('drift between branch-protection.yml and live config:');
  for (const d of drift) console.error(`  - ${d}`);
  process.exit(1);
}
console.log(`verified: live protection matches .github/branch-protection.yml`);
