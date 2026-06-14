import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@loopdog/config';

/**
 * `loopdog promote <loop> --to <mode>` (task 0009): the explicit, audited
 * promotion path. Rewrites the loop file's `mode:` line in place (comment
 * preserving). Guard: a `tier: core` MERGE loop can never be promoted to
 * auto-act — graduated auto-merge stays human-gated forever.
 */
export function registerPromote(program: Command): void {
  program
    .command('promote')
    .description('change a loop’s execution mode (dry-run → suggest → act)')
    .argument('<loop>', 'loop name (folder under .loopdog/loops/)')
    .requiredOption('--to <mode>', 'target mode: dry-run | suggest | act')
    .option('--path <dir>', 'repo root', '.')
    .action(async (loopName: string, opts: { to: string; path: string }) => {
      const to = opts.to;
      if (!['dry-run', 'suggest', 'act'].includes(to)) {
        console.error(`invalid mode '${to}' (dry-run | suggest | act)`);
        process.exitCode = 1;
        return;
      }

      const result = await loadConfig(opts.path);
      if (!result.ok || !result.config) {
        console.error('config invalid — fix `loopdog config validate` errors first.');
        process.exitCode = 1;
        return;
      }
      const loop = result.config.loops.find((l) => l.name === loopName);
      if (!loop) {
        console.error(`no loop named '${loopName}' under .loopdog/loops/`);
        process.exitCode = 2;
        return;
      }

      if (to === 'act' && loop.gates.tier === 'core' && loop.transition.to === 'merged') {
        console.error(
          `refused: '${loopName}' is a tier:core merge loop — auto-merge of core paths ` +
            'stays human-gated (the one dial a loop must never turn itself).',
        );
        process.exitCode = 1;
        return;
      }

      const file = join(opts.path, '.loopdog', 'loops', loopName, 'loop.yml');
      const text = await readFile(file, 'utf8');
      const from = loop.mode;
      let next: string;
      if (/^mode:\s*\S+.*$/m.test(text)) {
        next = text.replace(/^mode:\s*\S+(.*)$/m, `mode: ${to}$1`);
      } else {
        next = text.trimEnd() + `\nmode: ${to}\n`;
      }
      await writeFile(file, next);
      console.log(`promoted '${loopName}': ${from} -> ${to}  (${file})`);
      console.log('the YAML diff is the audit trail — commit it.');
    });
}
