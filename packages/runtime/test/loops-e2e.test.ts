import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleEvent, handleSweep } from '@looper/runtime';
import type { ControllerOptions } from '@looper/runtime';
import { FakeBackend, FakeGitHub, InMemoryRunRecordStore } from '@looper/testing';
import { loadConfig } from '@looper/config';
import { renderCriteriaBlock, stateLabel } from '@looper/core';
import { buildScaffoldPlan } from '../../cli/src/commands/init.js';

/**
 * The M08-M11 capstone: a raw issue driven through the WHOLE lifecycle on the
 * real scaffolded templates — triage → groom (incl. the clarification path) →
 * implement (DoR gate + dispatch + PR ingest) → review (verdict) → fix →
 * merge (DoD + auto-merge) → deploy → smoke → deployed — entirely offline on
 * the fakes, zero quota. Also the seed of the 0085 scenario tier.
 */

const repo = { owner: 'o', repo: 'r' };
const issueRef = { ...repo, number: 1 };
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function scaffoldRepoDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'looper-e2e-'));
  dirs.push(dir);
  const templatesDir = fileURLToPath(new URL('../../../templates/', import.meta.url));
  const plan = await buildScaffoldPlan(templatesDir, dir);
  const { mkdir } = await import('node:fs/promises');
  for (const file of plan.files) {
    const target = join(dir, file.path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await readFile(file.source, 'utf8'));
  }
  // act mode end-to-end for this test (scaffold default is dry-run)
  const rootYml = join(dir, '.looper', 'looper.yml');
  await writeFile(rootYml, (await readFile(rootYml, 'utf8')).replace('mode: dry-run', 'mode: act'));
  return dir;
}

function makeWorld(repoDir: string) {
  const gh = new FakeGitHub();
  const backend = new FakeBackend(gh, { id: 'claude' });
  const records = new InMemoryRunRecordStore();
  const opts: ControllerOptions = {
    repoDir,
    repo,
    gh,
    backends: new Map([['claude', backend]]),
    records,
    botLogin: 'github-actions[bot]',
  };
  return { gh, backend, records, opts };
}

const GROOMED_CRITERIA = renderCriteriaBlock([
  { text: 'rate limit enforced', validation: { kind: 'test', ref: 'rl.test.ts' }, met: false },
]);
const GROOMED_PATCH = [
  GROOMED_CRITERIA,
  '<!-- looper:scope -->api/ratelimit only<!-- /looper:scope -->',
].join('\n');

describe('the four loops end-to-end (M08-M11)', () => {
  it('drives a raw issue to deployed through every loop', { timeout: 30000 }, async () => {
    const repoDir = await scaffoldRepoDir();
    expect((await loadConfig(repoDir)).ok).toBe(true);
    const { gh, backend, records, opts } = makeWorld(repoDir);
    await gh.ensureBranch(repo, 'main');
    gh.seedIssue({
      ref: issueRef,
      title: 'Add rate limiting',
      body: 'Please add rate limiting to the public API.',
      labels: [],
      author: { login: 'dana', type: 'User' },
    });

    // 1. HUMAN opens the issue → intake labels `new`, triage advances.
    const opened = await handleEvent(opts, 'issues', {
      action: 'opened',
      issue: { number: 1 },
      sender: { login: 'dana', type: 'User' },
    });
    expect(opened.intake).toBe(true);
    expect(opened.matchedLoops).toContain('triage');
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('needs-grooming'));

    // 2. GROOM (sweep carries the controller→controller handoff): the work
    //    cell grooms the body and verdicts ready.
    backend.simulate = async (fake, handle) => {
      const live = await fake.getIssue(handle.item);
      await fake.updateIssueBody(handle.item, `${live.body}\n\n${GROOMED_PATCH}`);
    };
    backend.resultVerdict = 'looper-verdict: ready';
    await handleSweep(opts); // dispatch groom
    await handleSweep(opts); // ingest → ready-for-agent
    const groomed = await gh.getIssue(issueRef);
    expect(groomed.labels).toContain(stateLabel('ready-for-agent'));
    // the durable plan exists and mirrors readiness (M04 wiring)
    const planFile = await gh.readFile(
      repo,
      'main',
      '.looper/plans/tasks/0001-add-rate-limiting.md',
    );
    expect(planFile!.content).toContain('Status: ready');

    // 3. IMPLEMENT: DoR passes → dispatch → the agent opens the PR → ingest.
    backend.simulate = undefined as never;
    backend.resultVerdict = undefined as never;
    await handleSweep(opts); // dispatch implement (item → in-progress)
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('in-progress'));
    await handleSweep(opts); // ingest the PR → in-review
    const inReview = await gh.getIssue(issueRef);
    expect(inReview.labels).toContain(stateLabel('in-review'));
    const prs = await gh.listPullRequestsByHeadPrefix(repo, 'looper/implement/');
    expect(prs).toHaveLength(1);
    const pr = prs[0]!;
    expect(pr.labels).toContain(stateLabel('in-review'));

    // 4. REVIEW: first pass requests changes (fallback), fix updates the SAME
    //    PR, second review approves.
    backend.resultVerdict = 'looper-verdict: changes-requested';
    await handleSweep(opts); // dispatch review (issue is processed first)
    await handleSweep(opts); // ingest verdict → changes-requested
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('changes-requested'));

    // fix: pushes to the same branch (simulate a new commit), re-enters review
    backend.simulate = async (fake) => {
      fake.seedPull({ ...pr, updatedAt: '2099-01-01T00:00:00Z' }); // the push
    };
    await handleSweep(opts); // dispatch fix
    await handleSweep(opts); // ingest (same PR, updated) → in-review
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('in-review'));

    backend.simulate = undefined as never;
    backend.resultVerdict = 'looper-verdict: approve';
    await handleSweep(opts); // dispatch review again
    await handleSweep(opts); // ingest → verified + criteria attested
    const verified = await gh.getIssue(issueRef);
    expect(verified.labels).toContain(stateLabel('verified'));
    expect(verified.body).toContain('- [x] rate limit enforced');

    // 5. MERGE: DoD gate — checks green + human approval → auto-merge.
    //    (the PR also reached `verified` via its own sweep candidacy)
    gh.setCheckRuns(repo, pr.headRef, [
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'build', status: 'completed', conclusion: 'success' },
    ]);
    gh.setReviews(pr.ref, [
      {
        author: { login: 'dana', type: 'User' },
        state: 'APPROVED',
        submittedAt: '2026-06-09T13:00:00Z',
        body: 'lgtm',
      },
    ]);
    await handleSweep(opts); // merge candidates form (issue relabels; PR verified)
    await handleSweep(opts); // merge loop: DoD pass → squash-merge
    const mergedPr = await gh.getPullRequest(pr.ref);
    expect(mergedPr.merged).toBe(true);
    expect(mergedPr.labels).toContain(stateLabel('merged'));

    // 6. DEPLOY → SMOKE → DEPLOYED. A merged PR is CLOSED and drops out of
    //    sweep scans — the deploy states ride the open ISSUE (the work item).
    await handleSweep(opts); // deploy: merged → deploying (on the issue)
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('deploying'));
    gh.setCheckRuns(repo, 'main', [
      { name: 'deploy', status: 'completed', conclusion: 'success' },
      { name: 'deploy-smoke', status: 'completed', conclusion: 'success' },
    ]);
    await handleSweep(opts); // smoke green → deployed
    expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('deployed'));

    // run records exist for every acted step; no token-shaped strings leaked
    expect(records.records.length).toBeGreaterThanOrEqual(8);
    const serialized = JSON.stringify(records.records);
    expect(serialized).not.toMatch(/ghp_|sk-ant-/);
  });

  it(
    'grooming ambiguity routes to clarification; a human reply resumes it',
    { timeout: 30000 },
    async () => {
      const repoDir = await scaffoldRepoDir();
      const { gh, backend, opts } = makeWorld(repoDir);
      await gh.ensureBranch(repo, 'main');
      gh.seedIssue({
        ref: issueRef,
        title: 'Make it faster',
        body: 'Too slow.',
        labels: [stateLabel('needs-grooming')],
      });

      // groom verdicts needs-clarification (genuinely ambiguous)
      backend.resultVerdict = 'looper-verdict: needs-clarification';
      await handleSweep(opts);
      await handleSweep(opts);
      expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('needs-clarification'));

      // a human reply fires issue_comment.created → the clarify loop re-grooms
      backend.simulate = async (fake, handle) => {
        const live = await fake.getIssue(handle.item);
        await fake.updateIssueBody(handle.item, `${live.body}\n\n${GROOMED_PATCH}`);
      };
      backend.resultVerdict = 'looper-verdict: ready';
      const replied = await handleEvent(opts, 'issue_comment', {
        action: 'created',
        issue: { number: 1 },
        comment: { author_association: 'OWNER' },
        sender: { login: 'dana', type: 'User' },
      });
      expect(replied.matchedLoops).toContain('clarify'); // event-driven, never polled
      await handleSweep(opts); // ingest the re-groom → ready-for-agent
      expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('ready-for-agent'));
    },
  );

  it(
    'blast radius halts a scope-exceeding PR and escalates (0038)',
    { timeout: 30000 },
    async () => {
      const repoDir = await scaffoldRepoDir();
      // tighten the implement loop's limit
      const loopFile = join(repoDir, '.looper/loops/implement/loop.yml');
      await writeFile(
        loopFile,
        (await readFile(loopFile, 'utf8')).replace('max_files: 20', 'max_files: 2'),
      );
      const { gh, backend, opts } = makeWorld(repoDir);
      await gh.ensureBranch(repo, 'main');
      gh.seedIssue({
        ref: issueRef,
        title: 'Small fix',
        body: `do it\n\n${GROOMED_PATCH}`,
        labels: [stateLabel('ready-for-agent')],
      });
      backend.simulate = async (fake, handle) => {
        fake.seedPull({
          ref: { ...repo, number: 9100 },
          headRef: handle.expectedBranch,
          body: `Implements #1.\n\n${handle.expectedTrailer}`,
          changedFiles: 14, // way over max_files: 2
          updatedAt: '2099-01-01T00:00:00Z',
        });
      };
      await handleSweep(opts); // dispatch
      await handleSweep(opts); // ingest → blast-radius halt
      const issue = await gh.getIssue(issueRef);
      expect(issue.labels).toContain('looper:needs-human');
      expect(issue.labels).not.toContain(stateLabel('in-review'));
      const comments = await gh.listComments(issueRef);
      expect(comments.some((c) => c.body.includes('over the loop'))).toBe(true);

      // smoke-red path is covered in the main e2e via the fallback machinery
    },
  );

  it(
    'a red smoke check fails over to deploy-failed and rollback completes (0047/0048)',
    { timeout: 30000 },
    async () => {
      const repoDir = await scaffoldRepoDir();
      const { gh, opts } = makeWorld(repoDir);
      await gh.ensureBranch(repo, 'main');
      // the work item (issue) sits in deploying; the PR already merged + closed
      gh.seedIssue({
        ref: issueRef,
        title: 'Shipped change',
        body: 'deployed thing',
        labels: [stateLabel('deploying')],
      });
      gh.setCheckRuns(repo, 'main', [
        { name: 'deploy', status: 'completed', conclusion: 'success' },
        { name: 'deploy-smoke', status: 'completed', conclusion: 'failure' },
      ]);
      await handleSweep(opts); // smoke red → fallback deploy-failed
      expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('deploy-failed'));

      gh.setCheckRuns(repo, 'main', [
        { name: 'deploy', status: 'completed', conclusion: 'success' },
        { name: 'deploy-smoke', status: 'completed', conclusion: 'failure' },
        { name: 'rollback', status: 'completed', conclusion: 'success' },
      ]);
      await handleSweep(opts); // rollback check green → rolled-back
      expect((await gh.getIssue(issueRef)).labels).toContain(stateLabel('rolled-back'));
    },
  );
});
