import type { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@looper/config';
import { DEFAULT_TRANSITION_TABLE, validateLoopTransition } from '@looper/core';
import { resolveArtifact, createFsPromptSource, checkCompatibility } from '@looper/runtime';
import { findTemplatesDir } from '../assets.js';

/**
 * `looper loops list|show|new` (tasks 0068/0078): what loops exist, what each
 * runs, how it's prompted, what its steps are — and authoring a new loop via
 * a short questionnaire ("loops are data": a folder, never core code).
 */
export function registerLoops(program: Command): void {
  const loops = program.command('loops').description('manage and inspect loops');

  loops
    .command('list')
    .option('--path <dir>', 'repo root', '.')
    .option('--json', 'machine output', false)
    .description('every declared loop: transition, trigger, backend, mode, tier')
    .action(async (opts: { path: string; json: boolean }) => {
      const config = await mustLoad(opts.path);
      if (!config) return;
      const rows = config.loops.map((l) => ({
        name: l.name,
        transition:
          `${l.transition.from} -> ${l.transition.to}` +
          (l.transition.fallback ? ` (fallback ${l.transition.fallback})` : ''),
        trigger:
          l.trigger.kind === 'cron' ? `cron ${l.trigger.schedule}` : l.trigger.events.join(', '),
        backend: l.expects ? l.backend : '(deterministic)',
        mode: l.mode,
        tier: l.gates.tier,
      }));
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.name.padEnd(13)} ${r.transition.padEnd(44)} on ${r.trigger.padEnd(34)} ` +
            `${r.backend.padEnd(15)} mode=${r.mode} tier=${r.tier}`,
        );
      }
    });

  loops
    .command('show')
    .argument('<loop>', 'loop name')
    .option('--path <dir>', 'repo root', '.')
    .option('--json', 'machine output', false)
    .description('full config, prompt artifact, transition steps, and capability fit')
    .action(async (loopName: string, opts: { path: string; json: boolean }) => {
      const config = await mustLoad(opts.path);
      if (!config) return;
      const loop = config.loops.find((l) => l.name === loopName);
      if (!loop) {
        console.error(`no loop named '${loopName}'`);
        process.exitCode = 2;
        return;
      }
      const templatesDir = await findTemplatesDir().catch(() => undefined);
      const source = createFsPromptSource(opts.path, templatesDir);
      const artifact = loop.expects
        ? await resolveArtifact(source, loop.name, loop.backend).catch(() => null)
        : null;
      const steps = [
        `1. trigger: ${loop.trigger.kind === 'cron' ? `cron ${loop.trigger.schedule}` : loop.trigger.events.join(', ')}`,
        `2. pre-flight: gates (DoR=${loop.gates.requireDor}) + authorization + budget/quota/kill-switch`,
        ...(loop.expects
          ? [
              `3. claim -> compose brief (${loop.promptPath}) -> dispatch to ${loop.backend}`,
              `4. ingest result -> ${loop.transition.to}` +
                (loop.transition.fallback
                  ? ` (or ${loop.transition.fallback} on verdict/red)`
                  : ''),
            ]
          : [
              `3. claim -> deterministic transition -> ${loop.transition.to}` +
                (loop.transition.fallback ? ` (or ${loop.transition.fallback})` : '') +
                (loop.gates.requiredChecks?.length
                  ? ` gated on checks [${loop.gates.requiredChecks.join(', ')}]`
                  : ''),
            ]),
        `${loop.expects ? 5 : 4}. plan sync + run record`,
      ];
      const data = {
        ...loop,
        promptSource: artifact?.source ?? null,
        steps,
      };
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`# loop: ${loop.name}\n`);
      console.log(
        `mode=${loop.mode} tier=${loop.gates.tier} backend=${loop.expects ? loop.backend : '(deterministic)'}` +
          (loop.ensemble?.enabled ? ' ensemble=on' : ''),
      );
      console.log(`\n## steps\n${steps.map((s) => `  ${s}`).join('\n')}`);
      if (artifact) {
        console.log(`\n## prompt (${artifact.source})\n`);
        console.log(artifact.body.split('\n').slice(0, 20).join('\n'));
        console.log(`\n(see the full brief: looper prompts show ${loop.name})`);
      }
      void checkCompatibility;
    });

  loops
    .command('new')
    .description('author a new loop (questionnaire → folder scaffold → validate)')
    .option('--path <dir>', 'repo root', '.')
    .option('--name <name>', 'loop name (kebab-case)')
    .option('--event <event>', "github event, e.g. 'issues.labeled'")
    .option('--cron <schedule>', 'cron schedule (hourly|daily|weekly|expr)')
    .option('--from <state>', 'from state')
    .option('--to <state>', 'to state')
    .option('--backend <backend>', 'claude | codex | self-hosted')
    .option('--expects <kind>', 'pull-request | comment | plan-update | none', 'none')
    .action(
      async (opts: {
        path: string;
        name?: string;
        event?: string;
        cron?: string;
        from?: string;
        to?: string;
        backend?: string;
        expects: string;
      }) => {
        let { name, event, cron, from, to } = opts;
        if ((!name || !from || !to || (!event && !cron)) && process.stdin.isTTY) {
          const { text, select, isCancel } = await import('@clack/prompts');
          const ask = async (q: string, placeholder?: string) => {
            const answer = await text({ message: q, placeholder: placeholder ?? '' });
            if (isCancel(answer)) throw new Error('cancelled');
            return String(answer);
          };
          name = name ?? (await ask('Loop name (kebab-case)?', 'dep-update'));
          const kind = await select({
            message: 'Trigger kind?',
            options: [
              { value: 'cron', label: 'cron (scheduled)' },
              { value: 'event', label: 'github event' },
            ],
          });
          if (isCancel(kind)) throw new Error('cancelled');
          if (kind === 'cron') cron = cron ?? (await ask('Schedule?', 'weekly'));
          else event = event ?? (await ask('Event?', 'issues.labeled'));
          from = from ?? (await ask('From state?', 'scheduled'));
          to = to ?? (await ask('To state?', 'in-review'));
        }
        if (!name || !from || !to || (!event && !cron)) {
          console.error(
            'need --name, --from, --to and one of --event/--cron (or run interactively)',
          );
          process.exitCode = 1;
          return;
        }

        // Validate the transition BEFORE writing (the only two trigger kinds
        // and the legal-edge rule are the whole authoring surface).
        const edge = validateLoopTransition(
          DEFAULT_TRANSITION_TABLE,
          { from, to },
          { dispatches: opts.expects !== 'none' },
        );
        const declares = edge.legal
          ? ''
          : [
              `# this loop declares its custom states/edges (validated by looper):`,
              `declares:`,
              `  states: [${[from, to].filter((s) => !DEFAULT_TRANSITION_TABLE.states.includes(s)).join(', ')}]`,
              `  edges: [{ from: ${from}, to: ${to}, by: ${name} }]`,
            ].join('\n') + '\n';

        const dir = join(opts.path, '.looper', 'loops', name);
        await mkdir(dir, { recursive: true });
        const trigger = cron
          ? `trigger:\n  cron: "${cron}"`
          : `trigger:\n  github_event: ${event!.split('.')[0]}\n  action: [${event!.split('.')[1] ?? ''}]`;
        await writeFile(
          join(dir, 'loop.yml'),
          [
            `name: ${name}`,
            trigger,
            `transition: { from: ${from}, to: ${to} }`,
            ...(opts.expects !== 'none' ? [`expects: ${opts.expects}`] : []),
            ...(opts.backend ? [`backend: ${opts.backend}`] : []),
            `gates: { require_dor: false, require_ci: true, tier: default }`,
            `# mode inherits the root default (dry-run) until you promote:`,
            `#   looper promote ${name} --to act`,
            declares,
          ].join('\n') + '\n',
        );
        await writeFile(
          join(dir, 'prompt.md'),
          `# ${name}\n\nDescribe exactly what this loop's work cell must do.\n` +
            `The output contract (branch + looper-run trailer) is appended automatically.\n`,
        );

        const result = await loadConfig(opts.path);
        if (!result.ok) {
          console.error('scaffolded loop FAILED validation:');
          for (const e of result.errors) console.error(`  - ${e.file} ${e.path}: ${e.message}`);
          process.exitCode = 1;
          return;
        }
        console.log(`✓ created ${dir}/{loop.yml,prompt.md} — edit prompt.md next.`);
        console.log(`  try it: looper run ${name} --dry-run`);
      },
    );
}

async function mustLoad(path: string) {
  const result = await loadConfig(path);
  if (!result.ok || !result.config) {
    console.error('config invalid — run `looper config validate`');
    process.exitCode = 1;
    return null;
  }
  return result.config;
}
