import { describe, expect, it } from 'vitest';
import { buildProgram } from '@loopdog/cli';

describe('looper CLI program', () => {
  it('exposes the looper name and a version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('looper');
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('renders help text describing the tool', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('Usage: looper');
    expect(help).toContain('Autonomous-SDLC loops');
  });
});
