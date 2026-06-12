// @looper/adapters — project-adapter implementations: detect, generic, node,
// python (M06). The port lives in @looper/core; the registry is a small fixed
// array (no plugin loader).
import type { AdapterPhase, ProjectAdapter } from '@looper/core';
import { GenericCommandAdapter } from './generic/generic-adapter.js';
import type { GenericAdapterOptions } from './generic/generic-adapter.js';
import { NodeAdapter } from './node/node-adapter.js';
import { PythonAdapter } from './python/python-adapter.js';

export { GenericCommandAdapter } from './generic/generic-adapter.js';
export type { CommandSpec, GenericAdapterOptions } from './generic/generic-adapter.js';
export { NodeAdapter } from './node/node-adapter.js';
export type { NodeAdapterOptions } from './node/node-adapter.js';
export { PythonAdapter } from './python/python-adapter.js';
export type { PythonAdapterOptions } from './python/python-adapter.js';
export { DEFAULT_CONFIDENCE_FLOOR, chooseAdapter, detectStack } from './detect/detect.js';
export type { AdapterChoice, DetectionMatch } from './detect/detect.js';

export interface AdapterRegistryOptions {
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  runner?: 'uv' | 'poetry' | 'pip';
  commands?: Partial<Record<AdapterPhase, string | string[] | null>>;
  generic?: GenericAdapterOptions;
}

/** The fixed adapter set (node, python, generic) — codebase guardrail. */
export function createAdapterRegistry(opts: AdapterRegistryOptions = {}): ProjectAdapter[] {
  return [
    new NodeAdapter({ packageManager: opts.packageManager, commands: opts.commands }),
    new PythonAdapter({ runner: opts.runner, commands: opts.commands }),
    new GenericCommandAdapter(opts.generic ?? { commands: opts.commands }),
  ];
}
