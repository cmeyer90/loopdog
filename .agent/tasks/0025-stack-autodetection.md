# 0025 Stack Auto-Detection

Status: planned  
Branch: task/0025-stack-autodetection

## Goal

Given an adopter repo's contents, deterministically pick the best-fitting project
adapter (Node, Python, …) — or fall back to the generic command adapter (0026) —
so looper can build/test/lint/run/deploy any repo on day one without hand-written
config, while always letting explicit config override the guess.

## Background

Part of [Milestone 06](../milestones/milestone-06-project-adapter-system.md): the
project-adapter plugin system that makes "any GitHub repo" true (see
[architecture](../../docs/architecture.md) "Generic-ness, in three plugin systems"
→ *Project adapters*, and [codebase](../../docs/codebase.md) — the `adapters`
package: `interface,detect,generic,node,python`). The milestone's Guiding
Decisions require: auto-detect when possible, always allow explicit config to
override, and guarantee coverage via the generic adapter so no project is
unsupported. This task owns the `detect` half: scoring repo evidence into an
ordered adapter choice. It consumes the `ProjectAdapter` contract from 0024,
selects among the bundled adapters (0027), and defaults to the generic adapter
(0026). The chosen adapter is what the runtime pipeline (M03 · 0012) and the
brief composer use to tell the work cell how to build/test, and what the adopter's
CI invokes for the trustworthy gate (M03 · 0014).

## Scope

- A pure, IO-light detection function that takes a `RepoFs` (a read-only repo view:
  a file listing + the contents of a few well-known manifests) and returns a ranked list of
  adapter matches with confidence scores and the evidence behind each.
- Selection policy: highest-confidence adapter wins; ties broken deterministically;
  below a confidence floor → generic adapter (0026).
- Explicit-override path: when `looper.yml` names an adapter (or per-loop config
  does), detection is skipped/annotated, never silently overridden.
- Surfacing the result so `looper init` / `looper status` (M16) can show "detected
  Node (pnpm)" with its evidence, and so detection re-runs are reproducible.

### Technical detail

Lands in **`@looper/adapters`** (`packages/adapters/src/detect/`). Detection is a
pure function over an injected read-only filesystem view — **no direct `fs`**, so
it is unit-testable with the M18 fakes and runs identically in CI and locally.

```ts
// core declares the port shape + the read-only `RepoFs` view (M06 · 0024);
// detect implements selection. `RepoFs` is the same view passed to `ProjectAdapter.detect`.
interface RepoFs {
  files: string[];                         // repo-relative paths (globbed, bounded)
  read(path: string): string | undefined; // lazy read of a manifest, undefined if absent
}
interface DetectionMatch {
  adapter: string;                 // adapter name, e.g. "node" | "python" | "generic"
  confidence: number;              // 0..1
  evidence: string[];              // human-readable, e.g. ["package.json present", "pnpm-lock.yaml → pnpm"]
  toolchain?: Record<string,string>; // resolved hints, e.g. { packageManager: "pnpm" }
}
function detectStack(repo: RepoFs, opts?: { override?: string }): DetectionMatch[];
```

Each bundled adapter (0027) contributes a **signal set** (a small declarative
rule, not imperative code in `detect`): marker files (`package.json`,
`pyproject.toml`, `go.mod`), lockfiles that pin a sub-toolchain
(`pnpm-lock.yaml`/`yarn.lock`/`package-lock.json` → package manager;
`poetry.lock`/`requirements.txt`/`uv.lock` → Python runner), and weak signals
(extension census, e.g. `*.ts` ratio). `detectStack` runs every adapter's signals,
sums weighted hits into `confidence`, sorts desc, and breaks exact ties by a fixed
adapter priority order (declared once, not on file-walk order, for determinism).

Selection: `chooseAdapter(matches, config)` → if the scalar `config.adapter` is set
(an adapter `name`, default `"auto"` => detect), return it
with `evidence: ["explicit override in looper.yml"]` (still attach detection as
advisory); else top match if `confidence >= FLOOR` (default `0.5`, a `looper.yml`
key `adapters.detect.confidenceFloor`); else `generic` (0026) with evidence
`["no confident match; using generic command adapter"]`. **Never throw** — the
generic fallback guarantees a usable result.

Config keys (root `looper.yml`, validated in `@looper/config`):
`adapter:` (scalar adapter `name`; default `"auto"` => auto-detect; an explicit name
skips scoring), `adapters.detect.confidenceFloor:`,
`adapters.detect.disable: [<name>...]` (exclude an adapter from scoring). Edge
cases: monorepo with multiple manifests → return multiple matches, document that
0027/runtime may scope by path later (out of scope here); empty repo → generic;
manifest present but unparseable → still counts as a marker hit, parse failure is
swallowed into `evidence` not thrown; conflicting strong signals (Node + Python)
→ both ranked, highest wins, both surfaced.

## Out Of Scope

- The `ProjectAdapter` interface itself (0024) and the bundled adapter command
  implementations (0027).
- The generic command adapter's config schema and execution (0026).
- Monorepo sub-project scoping / per-path adapters (future).
- Wiring detection into the brief composer / CI invocation (runtime, M08+).

## Acceptance Criteria

- [ ] `detectStack` returns a ranked `DetectionMatch[]` with confidence + evidence
      for a Node repo, a Python repo, and a mixed repo (both ranked).
- [ ] A repo with no recognized markers selects the generic adapter (0026), never
      throws, and the evidence explains why.
- [ ] An explicit `adapter:` in `looper.yml` is honored verbatim; detection still
      runs and is attached as advisory, never overriding the explicit choice.
- [ ] Sub-toolchain hints are resolved (e.g. `pnpm-lock.yaml` → `packageManager: pnpm`).
- [ ] Selection is deterministic: same snapshot → same result, ties broken by the
      fixed priority order regardless of file ordering.
- [ ] Detection is pure over the injected `RepoFs` (no real `fs`), proven by tests
      using the M18 fakes.
- [ ] Relevant checks pass.

## Implementation Checklist

- [ ] Consume `RepoFs` (declared in `@looper/core` per 0024), define `DetectionMatch`,
      and provide a `RepoFs` impl backed by the GitHub port / local FS (thin, kept
      out of the pure `detect` core).
- [ ] Implement per-adapter declarative signal sets for `node` and `python` (0027).
- [ ] Implement `detectStack` scoring + deterministic tie-break + `chooseAdapter`
      selection with the confidence floor and generic fallback.
- [ ] Add `adapter` / `adapters.detect.*` keys to the `@looper/config` schema.
- [ ] Surface the detection result for `looper init`/`status` (M16).

## Test Plan

Tests run via the repo's vitest runner; all detection cases use the M18 in-memory
snapshot fakes — no real filesystem, no quota.

```bash
# replace with the repo's vitest invocation
# fixtures: node-pnpm, python-poetry, mixed, empty, explicit-override, unparseable-manifest
# assert ranked matches, evidence strings, generic fallback, override-wins, determinism
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the signal weights + confidence-floor default, the fixed adapter priority
order used for tie-breaking, and the exact config keys.

## Risks / Rollback

A wrong guess sends the work cell the wrong build/test commands. Mitigations: the
confidence floor + generic fallback bias toward "safe and explicit"; detection is
always advisory and overridable in `looper.yml`; the result is surfaced with
evidence so an adopter can correct it during `looper init`. Rollback is config-only
(set `adapter:` explicitly) — no state migration.

## Final Summary

Fill this in before marking verified.
