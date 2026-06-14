import { describe, expect, it } from 'vitest';
import { buildProgram } from '@loopdog/cli';

describe('loopdog CLI program', () => {
  it('exposes the loopdog name and a version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('loopdog');
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('renders help text describing the tool', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('Usage: loopdog');
    expect(help).toContain('Autonomous-SDLC loops');
  });
});
