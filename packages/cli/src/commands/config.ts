import type { Command } from 'commander';
import { loadConfig } from '@loopdog/config';

/** `loopdog config validate` (task 0006): per-field errors with file + path. */
export function registerConfig(program: Command): void {
  const config = program.command('config').description('configuration tools');

  config
    .command('validate')
    .description('validate .loopdog/loopdog.yml + every loop folder')
    .option('--path <dir>', 'repo root', '.')
    .action(async (opts: { path: string }) => {
      const result = await loadConfig(opts.path);
      for (const w of result.warnings) {
        console.warn(`warning: ${w.file}${w.path ? ` (${w.path})` : ''}: ${w.message}`);
      }
      if (!result.ok) {
        console.error('config INVALID:');
        for (const e of result.errors) {
          console.error(`  - ${e.file}${e.path ? ` (${e.path})` : ''}: ${e.message}`);
        }
        process.exitCode = 1;
        return;
      }
      const loops = result.config!.loops;
      console.log(`config OK — ${loops.length} loop(s):`);
      // Align name + transition columns to content so the [mode] column lines up.
      const rows = loops.map((l) => ({
        name: l.name,
        transition: `${l.transition.from} -> ${l.transition.to}`,
        tail: `[${l.mode}${l.expects ? `, ${l.expects} via ${l.backend}` : ', deterministic'}]`,
      }));
      const nameW = Math.max(...rows.map((r) => r.name.length));
      const transW = Math.max(...rows.map((r) => r.transition.length));
      for (const r of rows) {
        console.log(`  ${r.name.padEnd(nameW)}  ${r.transition.padEnd(transW)}  ${r.tail}`);
      }
    });
}
