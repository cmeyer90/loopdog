import type { Command } from 'commander';
import { OctokitGitHub, parseRepoFromRemoteUrl, resolveGitHubAuth } from '@loopdog/github';
import type { RepoRef, WorkflowSummary, WorkflowsPort } from '@loopdog/core';

/**
 * `loopdog workflows` (task 0099): inspect and flip the GitHub Actions workflows
 * that drive loopdog. The controller only runs because `loopdog-events` and
 * `loopdog-sweep` fire it — if either is disabled (manually, or GitHub's 60-day
 * scheduled-workflow auto-disable), new issues silently stall. This is the
 * operator surface to see that and fix it without leaving the CLI. Uses the
 * operator's `gh`/token (needs `actions:write`), never the runtime token.
 */
export function registerWorkflows(program: Command): void {
  const workflows = program
    .command('workflows')
    .alias('wf')
    .description('enable/disable the GitHub Actions workflows that drive loopdog');

  workflows
    .command('list', { isDefault: true })
    .description('show loopdog workflows and whether each is enabled')
    .option('--repo <owner/name>', 'target repo')
    .option('--all', 'include the repo’s non-loopdog workflows', false)
    .option('--json', 'machine output', false)
    .action(async (opts: { repo?: string; all: boolean; json: boolean }) => {
      const { gh, repo } = await connect(opts.repo);
      const all = await gh.listWorkflows(repo);
      const shown = opts.all ? all : all.filter(isLoopdogWorkflow);
      if (opts.json) {
        console.log(
          JSON.stringify({ repo: `${repo.owner}/${repo.repo}`, workflows: shown }, null, 2),
        );
        return;
      }
      console.log(renderWorkflowList(`${repo.owner}/${repo.repo}`, shown, all, opts.all));
    });

  workflows
    .command('enable')
    .description('enable loopdog workflows (default: all of them)')
    .argument('[names...]', 'workflow names, e.g. events sweep (default: all loopdog workflows)')
    .option('--repo <owner/name>', 'target repo')
    .action((names: string[], opts: { repo?: string }) => setState('enable', names, opts));

  workflows
    .command('disable')
    .description('disable loopdog workflows (default: all of them)')
    .argument('[names...]', 'workflow names, e.g. sweep (default: all loopdog workflows)')
    .option('--repo <owner/name>', 'target repo')
    .action((names: string[], opts: { repo?: string }) => setState('disable', names, opts));
}

async function setState(
  action: 'enable' | 'disable',
  names: string[],
  opts: { repo?: string },
): Promise<void> {
  const { gh, repo } = await connect(opts.repo);
  const all = await gh.listWorkflows(repo);
  const loopdog = all.filter(isLoopdogWorkflow);

  const { targets, unknown } = selectTargets(all, loopdog, names);

  for (const name of unknown) {
    const localOnly = !all.length;
    console.error(
      `no workflow matching '${name}' is registered on ${repo.owner}/${repo.repo}` +
        (localOnly
          ? ' (no workflows registered yet — push .github/workflows/ first; new workflows start enabled).'
          : '. Run `loopdog workflows list --all` to see what is registered.'),
    );
  }
  if (targets.length === 0) {
    if (unknown.length === 0) {
      console.log(
        names.length
          ? 'nothing to do.'
          : 'no loopdog workflows registered yet — push .github/workflows/ first (they start enabled).',
      );
    }
    process.exitCode = unknown.length ? 2 : 0;
    return;
  }

  const results = await applyWorkflowState(gh, repo, action, targets);
  for (const r of results) {
    const verb = action === 'enable' ? 'enabled' : 'disabled';
    const changed = r.before !== r.after;
    console.log(
      `  ${changed ? '✓' : '·'} ${verb} ${shortName(r.workflow)}` +
        (changed ? `  (was ${r.before})` : '  (already ' + r.after + ')'),
    );
  }
  if (action === 'enable') {
    console.log('\nNew issues and the reconcile sweep will drive the pipeline again.');
  } else {
    console.log('\nThe pipeline is paused for these workflows until re-enabled.');
  }
}

// ---- pure helpers (unit-tested without a network) ----

/** Loopdog scaffolds its workflows as `.github/workflows/loopdog-*.yml`. */
export function isLoopdogWorkflow(w: WorkflowSummary): boolean {
  return basename(w.path).startsWith('loopdog-');
}

/** The short handle for a loopdog workflow: `loopdog-events.yml` → `events`. */
export function shortName(w: WorkflowSummary): string {
  const base = basename(w.path).replace(/\.ya?ml$/i, '');
  return base.startsWith('loopdog-') ? base.slice('loopdog-'.length) : base;
}

/** Normalize a user-supplied name to compare against a workflow: strip dir, extension, `loopdog-`. */
function normalizeName(name: string): string {
  const base = basename(name).replace(/\.ya?ml$/i, '');
  return (base.startsWith('loopdog-') ? base.slice('loopdog-'.length) : base).toLowerCase();
}

/** Find the workflow a user means by `events` / `loopdog-events` / `loopdog-events.yml`. */
export function matchWorkflow(
  name: string,
  workflows: readonly WorkflowSummary[],
): WorkflowSummary | undefined {
  const wanted = normalizeName(name);
  return (
    workflows.find((w) => shortName(w).toLowerCase() === wanted) ??
    workflows.find(
      (w) =>
        basename(w.path)
          .replace(/\.ya?ml$/i, '')
          .toLowerCase() === wanted,
    ) ??
    workflows.find((w) => w.name.toLowerCase() === name.toLowerCase())
  );
}

/**
 * Resolve targets for enable/disable. No names → every loopdog workflow. Named →
 * resolve each against ALL workflows (so an operator can name `ci` explicitly),
 * collecting the ones that don't match.
 */
export function selectTargets(
  all: readonly WorkflowSummary[],
  loopdog: readonly WorkflowSummary[],
  names: readonly string[],
): { targets: WorkflowSummary[]; unknown: string[] } {
  if (names.length === 0) return { targets: [...loopdog], unknown: [] };
  const targets: WorkflowSummary[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const match = matchWorkflow(name, all);
    if (match && !targets.some((t) => t.id === match.id)) targets.push(match);
    else if (!match) unknown.push(name);
  }
  return { targets, unknown };
}

export interface WorkflowChange {
  workflow: WorkflowSummary;
  before: WorkflowSummary['state'];
  after: WorkflowSummary['state'];
}

/** Flip each target's state, returning before/after for reporting. Idempotent per GitHub. */
export async function applyWorkflowState(
  gh: WorkflowsPort,
  repo: { owner: string; repo: string },
  action: 'enable' | 'disable',
  targets: readonly WorkflowSummary[],
): Promise<WorkflowChange[]> {
  const changes: WorkflowChange[] = [];
  for (const wf of targets) {
    const before = wf.state;
    if (action === 'enable') await gh.enableWorkflow(repo, wf.id);
    else await gh.disableWorkflow(repo, wf.id);
    changes.push({
      workflow: wf,
      before,
      after: action === 'enable' ? 'active' : 'disabled_manually',
    });
  }
  return changes;
}

export function renderWorkflowList(
  repoLabel: string,
  shown: readonly WorkflowSummary[],
  all: readonly WorkflowSummary[],
  showingAll: boolean,
): string {
  const lines = [`${repoLabel} — ${showingAll ? 'all workflows' : 'loopdog workflows'}`, ''];
  if (shown.length === 0) {
    lines.push(
      all.length === 0
        ? '  (no workflows registered — push .github/workflows/ first; new workflows start enabled)'
        : '  (no loopdog workflows registered — run `loopdog init`, commit, and push)',
    );
    return lines.join('\n');
  }
  const nameW = Math.max(...shown.map((w) => shortName(w).length));
  const pathW = Math.max(...shown.map((w) => w.path.length));
  for (const w of shown) {
    const on = w.state === 'active';
    lines.push(
      `  ${on ? '●' : '○'}  ${shortName(w).padEnd(nameW)}  ${w.path.padEnd(pathW)}  ${w.state}`,
    );
  }
  const enabled = shown.filter((w) => w.state === 'active').length;
  const disabled = shown.length - enabled;
  lines.push('');
  lines.push(
    `${enabled} enabled · ${disabled} disabled` +
      (disabled ? ' · `loopdog workflows enable` turns them all on' : ''),
  );
  return lines.join('\n');
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

// ---- repo + auth wiring (mirrors run.ts / status.ts) ----

async function connect(repoArg?: string): Promise<{ gh: OctokitGitHub; repo: RepoRef }> {
  const repo = await resolveRepo(repoArg);
  const auth = await resolveGitHubAuth();
  return { gh: new OctokitGitHub({ token: auth.token }), repo };
}

async function resolveRepo(repoArg?: string): Promise<RepoRef> {
  if (repoArg) {
    const [owner, repo] = repoArg.split('/');
    if (!owner || !repo) throw new Error(`--repo must be owner/name, got '${repoArg}'`);
    return { owner, repo };
  }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['remote', 'get-url', 'origin']);
  const parsed = parseRepoFromRemoteUrl(stdout.trim());
  if (!parsed) throw new Error('cannot infer repo; pass --repo owner/name');
  return parsed;
}
