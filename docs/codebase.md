# Looper — Codebase Architecture & Module Layout

> The **structure** doc: how the code is organized, where boundaries are, and the
> order to build it. The product "why/what" is [`architecture.md`](architecture.md);
> the roadmap is [`../.agent/milestones.md`](../.agent/milestones.md). Ratified by
> Milestone 01 · 0001.

## Goal of this layout

Clean, modular, production-intent, easy to maintain. **No mega-files, no
hero-folders.** Boundaries are enforced by package edges, not discipline alone.
Pragmatic, not over-engineered: ~8 small packages with one job each, plain
interfaces and dependency injection (no framework), and "loops are data" so
behavior is config, not code.

## Stack (decision — 2026-06-08, ratified in M01 · 0001)

**TypeScript (strict) on Node 20+, an npm-workspaces monorepo.** Rationale: looper
*is* a GitHub-Actions + Octokit + CLI tool, and that ecosystem is JS-native —
`@octokit/*` (REST/GraphQL), `@actions/*`, npm distribution, one language for the
CLI and the controller it invokes in Actions. Default toolchain (finalize in 0001,
don't over-specify): `tsup`/`tsc` build · `vitest` tests · `eslint` + `prettier` ·
`commander` CLI · `@clack/prompts` for the questionnaire · `zod` for config
schemas. *Alternative considered:* Go single-binary CLI — rejected because the
GitHub Actions + Octokit + CLI surface is where looper lives, and that's JS.

## Packages (the boundaries)

Each is `@looper/<name>`, one responsibility, its public API is its `index.ts`.

| Package | Responsibility | Depends on |
|---|---|---|
| `core` | Pure domain: state machine, transition decision logic, DoR/DoD gates, run-record types, idempotency keys, **and the port interfaces** (`Backend`, `ProjectAdapter`, `PlanStore`, `GitHubPort`, `SecretBackend`). No IO. | — |
| `config` | Root `looper.yml` + per-loop `loop.yml` schema, discovery, validation. | core |
| `github` | The GitHub port: Octokit wrapper over `GITHUB_TOKEN`, labels/issues/PRs, claim/lease, event parsing, identity. | core |
| `plans` | Durable plan store: read/write milestones+tasks into the repo. | core, github |
| `backends` | Execution-backend interface impls: `claude`, `codex`, `self-hosted` + dispatch/ingest correlation. | core, github |
| `adapters` | Project-adapter impls: `detect`, `generic`, `node`, `python`. | core |
| `runtime` | The controller / composition root: triggers + reconcile sweep + the effectful transition pipeline + telemetry, plus the **built-in loop definitions** (config + prompts as assets). | core + all ports |
| `cli` | The `looper` binary (login, init, loops, runs, status, prompts) — the same entrypoint Actions invoke. | runtime, config, github |
| `testing` | **Dev-only.** The fakes (in-memory GitHub, fake/replay backends) + scenario & simulation runner + fixtures. Not shipped. | core (+ test-time peers) |

**Dependency direction is one-way:** `core` ← ports (`config`/`github`/`plans`/
`backends`/`adapters`) ← `runtime` ← `cli`. Nothing depends on `cli`; nothing
imports another package's internals. Ports implement interfaces declared in
`core`, and `runtime` injects the concrete impls — dependency inversion without a
DI framework.

## Filetree

```
looper/
├── package.json                 # npm workspaces root
├── tsconfig.base.json
├── packages/
│   ├── core/src/{state-machine,transitions,gates,run-record,ports}/  + index.ts
│   ├── config/src/{schema,load,validate}/                            + index.ts
│   ├── github/src/{client,labels,claims,events,identity}/            + index.ts
│   ├── plans/src/{store,format}/                                     + index.ts
│   ├── backends/src/{interface,claude,codex,self-hosted,correlation}/+ index.ts
│   ├── adapters/src/{interface,detect,generic,node,python}/          + index.ts
│   ├── runtime/src/{pipeline,triggers,sweep,telemetry,loops-builtin}/+ index.ts
│   ├── cli/src/commands/{login,init,loops,runs,status,prompts}.ts    + index.ts
│   └── testing/src/{fake-github,fake-backends,scenario,simulation,fixtures}/  (dev-only)
├── templates/                   # what `looper init` scaffolds INTO an adopter repo:
│   ├── looper.yml               #   root config
│   ├── loops/<builtin>/         #   default loop.yml + prompt.md per built-in loop
│   └── workflows/looper-*.yml   #   the thin reusable-workflow callers
├── docs/                        # architecture.md, codebase.md, walkthroughs/
└── .agent/                      # looper's OWN durable plans (dogfooding the product)
```

Each package has a colocated `test/`. A package's `src/index.ts` is a thin barrel;
real logic lives in the focused subfolders.

## Build / implementation path (the clear order)

Bottom-up; each layer is testable before the next exists:

1. **`core`** — states, transitions, gates, run-record, port interfaces. Pure unit
   tests, no GitHub needed. *(M03 · 0011/0012-logic/0014)*
2. **`config`** — schemas + validation. *(M02 · 0006)*
3. **`github`** — Octokit wrapper, labels, claim/lease, events, App identity.
   *(M02 triggers, M03 · 0013, M07 · 0029)*
4. **`plans`** — durable plan store. *(M04)*
5. **`backends`** — interface + `claude` first, then correlation/ingest.
   *(M05 · 0019/0020/0073)*
6. **`adapters`** — interface + `generic` + `node`. *(M06)*
7. **`runtime`** — wire triggers → pipeline → backends → gates → plans → telemetry;
   add built-in loop assets. *(M03 · 0012-wiring, M08–M11, M12)*
8. **`cli`** — login/init/loops/runs/status/prompts. *(M16, M02 · 0007/0077)*

The loops (groom/implement/review/deploy, M08–M11) add **no code modules** — they
are `templates/loops/<name>/` assets the generic `runtime` pipeline executes. That
is the payoff of "loops are data."

## Modularity rules (how we avoid mega-files & hero-folders)

- **One responsibility per package**; cross-package access only through the
  published `index.ts`. No reaching into another package's `src`.
- **Interfaces live in `core`**, implementations in their package — so a boundary
  is a type, swapping a provider/adapter touches one package.
- **Split by concern, not by size** — but a file past ~300–400 lines or a folder
  past ~8–10 files is a smell to split. (Guideline, not a gate.)
- **No dumping grounds:** no `utils.ts`, `helpers/`, `common/`, or `misc/`. Name a
  module for what it does; if a helper has no home, it's a missing concept.
- **Tests colocated** with the package they cover; `core` stays IO-free so its
  tests need no network.

## Testing strategy

Looper is an autonomous dispatcher, so it must be provable **without burning
subscription quota or hitting real GitHub** (Milestone 18). The modular design
makes this cheap: IO is behind ports in `@looper/core`, so the `@looper/testing`
package injects in-memory fakes and runs the *real* controller. A five-tier
pyramid:

1. **unit** — `@looper/core` pure logic; no fakes (it's IO-free).
2. **component** — each port impl vs. a fake/recorded counterpart (backend +
   adapter conformance kits).
3. **scenario** — whole loops on **fake GitHub + fake/replay backend** → golden
   assertions on labels/PRs/plan/run-records. Deterministic, offline, free.
4. **simulation** — a deterministic clock + fault injection (event storms,
   event↔sweep races, dropped webhooks, mid-run crashes) → assert invariants
   (no double-dispatch, no stranded items, idempotent ingest).
5. **live-smoke** — a real scratch repo + real subscription, behind a
   **manual/nightly gate only** (to catch provider API drift, e.g. the beta routine
   API) — never gating every PR.

Provider calls in tiers 2–4 use scripted fakes or **record-once/replay cassettes**,
so no PR ever spends real quota.

## Deliberately *not* doing (pragmatism guardrails)

- No plugin-loader/marketplace framework — backends and adapters are a small fixed
  registry behind an interface; third parties use the conformance kit (M06 · 0028).
- No database, queue, or event bus — **GitHub is the store and the bus**.
- No separate `@looper/interfaces`, `@looper/utils`, or `action` package — ports
  live in `core`; the CLI is the single entrypoint Actions also call.
- No DI framework, no per-loop classes, no premature secrets framework (identity
  lives in `github`, provider auth in `backends`).

The line: ~8 shipped packages with crisp edges (plus a dev-only `testing` harness)
is the modular middle — not 3 mega-packages, not 20 micro-packages.
