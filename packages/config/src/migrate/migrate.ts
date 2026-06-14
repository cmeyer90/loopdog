/**
 * Versioned config contract + migration registry (task 0067). The on-disk
 * `.loopdog/loopdog.yml` carries a `version`; the controller refuses to run config
 * it doesn't understand, and `loopdog upgrade` lifts an older tree forward by
 * applying ordered, idempotent migrations.
 *
 * V1 baseline: `CONFIG_VERSION = 1` and there are no migrations yet (1 is the
 * first version). The machinery — the version gate, the ordered/gap-checked
 * registry, the no-op-on-current behavior — is in place so a future `2` adds one
 * registry entry and `loopdog upgrade` just works.
 */

export const CONFIG_VERSION = 1;
/** The oldest on-disk version `loopdog upgrade` can migrate forward from. */
export const MIN_MIGRATABLE_FROM = 1;

/** A file tree as a path → content map (the `.loopdog/` subtree). */
export type FileTree = Record<string, string>;

export interface Migration {
  /** Lifts a tree from `from` to `from + 1`. */
  from: number;
  to: number;
  description: string;
  /** Pure transform: returns the migrated tree (idempotent on already-migrated input). */
  apply(tree: FileTree): FileTree;
}

/**
 * Ordered, contiguous migration chain. Each entry lifts version N → N+1; the
 * registry is gap-checked at module load so a missing step is a hard error, not
 * a silent skip. Empty for V1 (version 1 is the baseline).
 */
export const MIGRATIONS: readonly Migration[] = [];

// Gap-check: the chain must be contiguous from MIN_MIGRATABLE_FROM to CONFIG_VERSION.
(() => {
  let expected = MIN_MIGRATABLE_FROM;
  for (const m of MIGRATIONS) {
    if (m.from !== expected || m.to !== m.from + 1) {
      throw new Error(
        `migration registry gap: expected a step from ${expected}, got ${m.from}→${m.to}`,
      );
    }
    expected = m.to;
  }
  if (expected !== CONFIG_VERSION) {
    throw new Error(
      `migration chain ends at ${expected}, but CONFIG_VERSION is ${CONFIG_VERSION} ` +
        `(add the missing migration(s) or fix CONFIG_VERSION)`,
    );
  }
})();

export type VersionStatus = 'current' | 'behind' | 'ahead' | 'too-old';

/** Classify an on-disk version against what this loopdog understands. */
export function classifyVersion(onDisk: number): VersionStatus {
  if (onDisk > CONFIG_VERSION) return 'ahead'; // downgrade — refuse
  if (onDisk === CONFIG_VERSION) return 'current';
  if (onDisk < MIN_MIGRATABLE_FROM) return 'too-old'; // too old to migrate — refuse
  return 'behind'; // in-range, migratable
}

export interface UpgradePlan {
  ok: boolean;
  status: VersionStatus;
  from: number;
  to: number;
  steps: Migration[];
  reason?: string;
}

/** Plan the migration chain from an on-disk version to CONFIG_VERSION. */
export function planUpgrade(onDisk: number): UpgradePlan {
  const status = classifyVersion(onDisk);
  const base = { status, from: onDisk, to: CONFIG_VERSION };
  switch (status) {
    case 'current':
      return { ...base, ok: true, steps: [], reason: 'already up to date' };
    case 'ahead':
      return {
        ...base,
        ok: false,
        steps: [],
        reason: `config version ${onDisk} is newer than this loopdog (${CONFIG_VERSION}) — upgrade loopdog, don't downgrade the config`,
      };
    case 'too-old':
      return {
        ...base,
        ok: false,
        steps: [],
        reason: `config version ${onDisk} is older than the minimum migratable version (${MIN_MIGRATABLE_FROM}) — re-scaffold with \`loopdog init\``,
      };
    case 'behind':
      return {
        ...base,
        ok: true,
        steps: MIGRATIONS.filter((m) => m.from >= onDisk && m.to <= CONFIG_VERSION),
      };
  }
}

/** Apply the planned migrations to a tree (idempotent; throws if not migratable). */
export function migrateTree(tree: FileTree, onDisk: number): FileTree {
  const plan = planUpgrade(onDisk);
  if (!plan.ok) throw new Error(plan.reason);
  let out = tree;
  for (const step of plan.steps) out = step.apply(out);
  return out;
}
