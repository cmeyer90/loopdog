import { DEFAULT_STATES, DEPLOY_STATES } from '@loopdog/core';
import type { LoopDefinition } from '@loopdog/core';
import type { ControllerDrift } from '../commands/controller-version.js';
import { bold, cyan, dim, green, magenta, red, yellow } from './colors.js';

/**
 * Pure renderer for `loopdog status` (task 0097). Folds the configured loops
 * together with live GitHub counts into a lifecycle-ordered fleet view. Kept
 * IO-free so it unit-tests without a network; the command in `status.ts` gathers
 * the data and hands a `StatusView` here.
 */

export interface LoopRow {
  name: string;
  from: string;
  to: string;
  fallback?: string | undefined;
  /** Compact trigger label, e.g. `issues.labeled` or a cron expression. */
  trigger: string;
  /** Execution mode shown to the user: act / suggest / observe (dry-run). */
  mode: 'act' | 'suggest' | 'observe';
  tier: 'safe' | 'default' | 'core';
  /** Open items currently sitting in this loop's `from` state; null = unknown. */
  waiting: number | null;
  /** A tier:core loop that lands on `merged` — permanently human-gated. */
  gated: boolean;
}

export interface StatusView {
  repo: string;
  killSwitch: boolean;
  backendDefault: string;
  loops: LoopRow[];
  attention: Array<{ label: string; count: number }>;
  throughput: { runs24h: number; done: number; failed: number };
  /** False when live GitHub counts could not be fetched (config-only render). */
  live: boolean;
  liveError?: string | undefined;
  /** Controller version-pin drift vs the installed CLI; omitted when nothing to say. */
  controller?: ControllerDrift | undefined;
}

const LIFECYCLE: readonly string[] = [...DEFAULT_STATES, ...DEPLOY_STATES];

function lifecycleRank(state: string): number {
  const i = LIFECYCLE.indexOf(state);
  return i === -1 ? LIFECYCLE.length : i;
}

const MODE_LABEL: Record<LoopDefinition['mode'], LoopRow['mode']> = {
  act: 'act',
  suggest: 'suggest',
  'dry-run': 'observe',
};

/** Map resolved loop definitions + live state counts into ordered display rows. */
export function buildLoopRows(
  loops: LoopDefinition[],
  stateCounts: Record<string, number>,
  live: boolean,
): LoopRow[] {
  return loops
    .map((l): LoopRow => {
      const gated = l.gates.tier === 'core' && l.transition.to === 'merged';
      // A fallback equal to `from` is "stay put" — the engine treats it as no
      // distinct edge (config validate.ts), so don't surface it as one.
      const fallback =
        l.transition.fallback && l.transition.fallback !== l.transition.from
          ? l.transition.fallback
          : undefined;
      return {
        name: l.name,
        from: l.transition.from,
        to: l.transition.to,
        fallback,
        trigger:
          l.trigger.kind === 'cron' ? `cron ${l.trigger.schedule}` : l.trigger.events.join(', '),
        mode: MODE_LABEL[l.mode],
        tier: l.gates.tier,
        waiting: live ? (stateCounts[l.transition.from] ?? 0) : null,
        gated,
      };
    })
    .sort(
      (a, b) =>
        lifecycleRank(a.from) - lifecycleRank(b.from) ||
        lifecycleRank(a.to) - lifecycleRank(b.to) ||
        a.name.localeCompare(b.name),
    );
}

const MODE_DOT: Record<LoopRow['mode'], string> = {
  act: green('●'),
  suggest: yellow('◐'),
  observe: dim('○'),
};

function modeCell(mode: LoopRow['mode'], width: number): string {
  const padded = mode.padEnd(width);
  if (mode === 'act') return green(padded);
  if (mode === 'suggest') return yellow(padded);
  return dim(padded);
}

function tierCell(tier: LoopRow['tier'], gated: boolean, width: number): string {
  const text = (gated ? `${tier}*` : tier).padEnd(width);
  if (tier === 'core') return magenta(text);
  if (tier === 'safe') return dim(text);
  return text;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

/**
 * One-line controller-pin nudge. `behind` is the actionable case (exact pin older
 * than the CLI → run `loopdog upgrade`); `ahead` means the local CLI is older than
 * what's deployed (update the CLI). Floating/current/none render nothing — status
 * stays uncluttered when there's nothing to do.
 */
function renderControllerDrift(drift: ControllerDrift | undefined): string | undefined {
  if (!drift) return undefined;
  if (drift.status === 'behind') {
    return (
      yellow('⚠ controller pinned ') +
      yellow(bold(`v${drift.pinned}`)) +
      yellow(` · CLI v${drift.cli} — run `) +
      yellow(bold('loopdog upgrade')) +
      yellow(' to re-sync')
    );
  }
  if (drift.status === 'ahead') {
    return dim(
      `controller pinned v${drift.pinned} · local CLI v${drift.cli} is older — update the CLI`,
    );
  }
  return undefined;
}

const MAX_FLOW = 54;

export function renderStatus(view: StatusView): string {
  const out: string[] = [];

  // ---- header band ----
  out.push(bold(view.repo));
  const acting = view.loops.filter((l) => l.mode === 'act').length;
  const observing = view.loops.filter((l) => l.mode === 'observe').length;
  const suggesting = view.loops.filter((l) => l.mode === 'suggest').length;
  const gatedCount = view.loops.filter((l) => l.gated).length;
  const summary = [
    `${view.loops.length} loops`,
    `${green(String(acting))} acting`,
    suggesting ? `${yellow(String(suggesting))} suggesting` : '',
    `${dim(String(observing))} observing`,
    gatedCount ? `${magenta(String(gatedCount))} gated` : '',
    `backend ${cyan(view.backendDefault)}`,
    view.killSwitch ? red(bold('■ KILL-SWITCH ON')) : dim('kill-switch off'),
  ].filter(Boolean);
  out.push(summary.join(dim(' · ')));
  const controllerLine = renderControllerDrift(view.controller);
  if (controllerLine) out.push(controllerLine);
  out.push('');

  if (view.loops.length === 0) {
    out.push(dim('No loops configured. Run `loopdog init` to scaffold the pipeline.'));
    return out.join('\n');
  }

  // ---- pipeline table ----
  // STAGE → FLOW → MODE → TIER → WAIT is the status story: which lifecycle step,
  // what it transitions, whether it's actually acting, whether it's gated, and
  // how many open items are queued at its entry state. Trigger/backend detail
  // lives in `loops list` / `--json`.
  const flows = view.loops.map((l) =>
    truncate(`${l.from} → ${l.to}` + (l.fallback ? ` ↘ ${l.fallback}` : ''), MAX_FLOW),
  );
  const wName = Math.max(5, ...view.loops.map((l) => l.name.length));
  const wFlow = Math.max(4, ...flows.map((f) => f.length));
  const wMode = 7; // 'suggest'
  const wTier = 8; // 'default' + gated mark

  const header =
    '  ' +
    'STAGE'.padEnd(wName) +
    '  ' +
    'FLOW'.padEnd(wFlow) +
    '  ' +
    'MODE'.padEnd(wMode) +
    '  ' +
    'TIER'.padEnd(wTier) +
    '  ' +
    'WAIT';
  out.push(dim(header));
  out.push(dim('  ' + '─'.repeat(header.length - 2)));

  for (let i = 0; i < view.loops.length; i++) {
    const l = view.loops[i]!;
    const dot = MODE_DOT[l.mode];
    const wait = l.waiting === null ? dim('—') : l.waiting > 0 ? bold(String(l.waiting)) : dim('·');
    out.push(
      `${dot} ` +
        bold(l.name.padEnd(wName)) +
        '  ' +
        flows[i]!.padEnd(wFlow) +
        '  ' +
        modeCell(l.mode, wMode) +
        '  ' +
        tierCell(l.tier, l.gated, wTier) +
        '  ' +
        wait,
    );
  }

  // ---- attention ----
  if (view.attention.length > 0) {
    out.push('');
    out.push(bold('ATTENTION') + dim(' — waiting on a human'));
    const wLabel = Math.max(...view.attention.map((a) => a.label.length));
    for (const a of view.attention) {
      out.push(`  ${yellow('▲')} ${a.label.padEnd(wLabel)}  ${bold(String(a.count))}`);
    }
  }

  // ---- throughput ----
  out.push('');
  const { runs24h, done, failed } = view.throughput;
  if (view.live) {
    out.push(
      dim('24h') +
        `  ${runs24h} runs · ${green(`${done} done`)} · ${failed ? red(`${failed} failed`) : dim('0 failed')}`,
    );
  } else {
    out.push(yellow(`live counts unavailable — ${view.liveError ?? 'GitHub unreachable'}`));
    out.push(dim('(showing configuration only; check `gh auth status` or set GITHUB_TOKEN)'));
  }

  if (view.loops.some((l) => l.gated)) {
    out.push(dim('* gated: tier:core merge stays human-gated and cannot be promoted to act.'));
  }

  return out.join('\n');
}
