# 0058 Docs Site & Quickstart

Status: planned  
Branch: task/0058-docs-site-and-quickstart

## Goal

Stand up looper's documentation site and its centerpiece: a **10-minute attach
quickstart** that takes a maintainer from "I have a GitHub repo and a Claude/Codex
subscription" to "looper is attached and groomed its first issue" — the product's
first impression and the hub every other M14 doc links into.

## Background

Part of [Milestone 14](../milestones/milestone-14-documentation-examples-and-trust.md):
the adoption surface for an open-source tool. The milestone's guiding decision is
that **docs are a first-class deliverable and the quickstart is the product's first
impression**. This task builds the *site shell + quickstart*; the config reference
(0059), authoring guides (0060), example attachments (0061), and security/trust
model (0062) are siblings that slot into the nav this task defines.

The site is the published front-end for the docs that already live in-repo: the
[architecture](../../docs/architecture.md) north-star, [codebase](../../docs/codebase.md)
module map, and the three [walkthroughs](../../docs/walkthroughs/README.md)
(connecting accounts · ticket lifecycle · creating a loop). The quickstart is the
linear, copy-pasteable distillation of the `looper login` (0077) → `looper init`
(0007) → first-issue flow; it must stay consistent with those commands and never
contradict the keyless-identity / subscription-driven / no-database model in
architecture.md "Execution model" and "Identity & secrets."

## Scope

- A docs site built from the existing `docs/` Markdown (static-site generator), with
  a stable nav, search, and a published URL via GitHub Pages.
- A linear **Quickstart** page: prerequisites → install → `looper login` → `looper
  init` → open a test issue → watch the groom loop run (dry-run) → promote one
  `tier:safe` loop to `act`. Target: a maintainer completes it in ~10 minutes.
- An **information architecture** (nav tree + landing page) with reserved slots for
  the sibling M14 pages and the auto-derived references so 0059–0062 drop in without
  re-architecting.
- A docs build + link-check that runs in CI and a Pages deploy workflow.

### Technical detail

**This task is doc-and-tooling, not a `@looper/*` runtime package.** Files land
under `docs/` and `.github/workflows/`; no `core`/`runtime` code changes. (One small
exception: a `looper docs` convenience that opens the site URL may be added to
`@looper/cli` `commands/`, but it is optional and out of the critical path.)

**Generator:** use a Markdown-native static-site generator that renders the existing
`docs/*.md` *in place* with minimal frontmatter churn — **VitePress** (Vite + Vue,
JS-native, matches the monorepo toolchain in codebase.md "Stack"). Config at
`docs/.vitepress/config.ts`; the existing `architecture.md`, `codebase.md`, and
`walkthroughs/*.md` become site pages unchanged except for optional frontmatter.
Avoid a heavyweight framework — no separate docs app, no React.

**Site tree** (under `docs/`):

```
docs/
├── .vitepress/config.ts        # nav, sidebar, search, base path for Pages
├── index.md                    # landing: one-paragraph model + "Quickstart" CTA
├── quickstart.md               # THIS task's centerpiece (linear, ~10 min)
├── concepts/                   # links to architecture.md sections (state machine,
│                               #   execution model, verification ladder)
├── reference/config.md         # slot for 0059 (placeholder stub now)
├── guides/{adapters,providers}.md  # slots for 0060 (placeholder stubs now)
├── examples.md                 # slot for 0061 (placeholder stub now)
├── trust/security.md           # slot for 0062 (placeholder stub now)
├── architecture.md             # existing — surfaced in nav
├── codebase.md                 # existing — surfaced in nav
└── walkthroughs/*.md           # existing — surfaced under "Walkthroughs"
```

**Quickstart contract** (the linear steps, each a copyable block):

1. **Prerequisites** — a GitHub repo you can push to + a Claude *or* Codex
   subscription. Note: no API key, no PAT, no looper-hosted account.
2. **Install** — `npm i -g @looper/cli` (or `npx @looper/cli`).
3. **`looper login`** (0077) — OAuth device flow via the public client_id *or* reuse
   of `gh`/git auth; connect the provider subscription. State plainly: **in CI the
   controller uses the Actions `GITHUB_TOKEN` and needs no login.**
4. **`looper init`** (0007) — scaffolds `looper.yml`, the built-in loop folders, and
   the event + sweep workflow callers; defaults to `mode: dry-run`. Commit + push.
5. **Open a test issue** — apply `looper:state/new`; the groom loop dispatches a
   provider-cloud task that posts a plan-as-contract with acceptance criteria.
6. **Watch it run** — read the run via `looper runs` / the Actions job summary; note
   the cron sweep carries controller→controller handoffs at tick pace (architecture
   "GITHUB_TOKEN mechanic").
7. **Promote to act** — flip one `tier:safe` loop from `dry-run` to `act` and re-run;
   keep `tier:core` human-gated. Link the security/trust model (0062) for blast-radius
   before granting autonomy.

Each step shows the **expected output** (what labels/comments/PR appear) so the
reader can self-verify. Where a command's exact surface is owned elsewhere, link the
canonical source (login → connecting-accounts walkthrough; lifecycle → ticket
walkthrough) rather than duplicating it — DRY across docs.

**Nav/config** (`config.ts`): top nav = Quickstart · Concepts · Reference · Guides ·
Examples · Trust; sidebar groups per section; `search: { provider: 'local' }` (no
external service, keyless, consistent with looper's no-hosted-infra tenet); `base:
'/looper/'` for project Pages. Reserve the Reference/Guides/Examples/Trust entries
now as stub pages so the nav is stable and 0059–0062 only fill content.

**Build + deploy:** add `docs:dev` / `docs:build` / `docs:preview` npm scripts at the
workspace root. A `.github/workflows/docs.yml` builds the site and runs a **link
checker** (e.g. `lychee` or `vitepress build` strict + a relative-link check) on PRs
touching `docs/`, and deploys to GitHub Pages on merge to the default branch via
`actions/deploy-pages`. Per the global note, do not block this task on the repo's
broader CI being green — the docs workflow is self-contained.

**Edge cases:** broken relative links between docs (link-check catches); `base` path
wrong → assets 404 on Pages (test the built output, not just dev); the existing
`docs/*.md` use repo-relative links (`../.agent/...`) that resolve on GitHub but not
on the site — the config must rewrite or the link-check must allowlist these; keep
the in-repo Markdown readable on GitHub *and* on the site (no site-only syntax in
shared files).

## Out Of Scope

- The config reference *content* (0059), authoring-guide *content* (0060), example
  attachment *repos* (0061), and the security/trust *document* (0062) — this task
  only creates their nav slots + placeholder stubs.
- The `looper login` / `looper init` *implementations* (0077 / 0007) — quickstart
  documents them, doesn't build them.
- A hosted docs service, versioned docs (multi-version dropdown), or i18n — post-V1.
- Rewriting architecture.md / codebase.md content; they are surfaced as-is.

## Acceptance Criteria

- [ ] `npm run docs:build` produces a static site from `docs/` with no broken
      internal links (link-check passes in CI).
- [ ] A Quickstart page covers the seven steps above (prereqs → login → init → test
      issue → watch → promote), each with a copyable command and expected output.
- [ ] The Quickstart is keyless-/subscription-consistent: it never instructs the user
      to paste an API key or PAT, and states the CI controller uses `GITHUB_TOKEN`.
- [ ] The site nav reserves stable slots for Reference (0059), Guides (0060),
      Examples (0061), and Trust (0062) as stub pages, plus surfaces the existing
      architecture, codebase, and walkthrough docs.
- [ ] The landing page leads with the one-paragraph model and a Quickstart CTA.
- [ ] A Pages deploy workflow publishes the site on merge to the default branch.
- [ ] A maintainer following only the Quickstart reaches "groom loop posted a
      plan-as-contract on a test issue" (validated by the example attachment, 0061).

## Implementation Checklist

- [ ] Add VitePress + `docs:dev|build|preview` scripts at the workspace root.
- [ ] Write `docs/.vitepress/config.ts` (nav, sidebar, local search, `base`).
- [ ] Write `docs/index.md` (landing) and `docs/quickstart.md` (the seven steps).
- [ ] Add stub pages for `reference/config.md`, `guides/{adapters,providers}.md`,
      `examples.md`, `trust/security.md` with a "coming in 00NN" note + nav entry.
- [ ] Surface existing `architecture.md`, `codebase.md`, `walkthroughs/*` in the nav.
- [ ] Add `.github/workflows/docs.yml`: build + link-check on PR, Pages deploy on merge.
- [ ] Verify the built site (not just dev) resolves all links and assets under `base`.

## Test Plan

Tests run via the repo's vitest runner where applicable; the docs build is exercised
as a CI step (no model quota, no GitHub API, fully offline).

```bash
# replace with the chosen stack's runner
npm run docs:build          # static site builds; exits non-zero on a broken link
npm run docs:preview        # serve the built output; spot-check nav + Quickstart
# link-check the built output (relative links + the base path) → zero broken
# (optional) a tiny vitest assertion that config.ts nav includes the 0059–0062 slots
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the chosen SSG (VitePress vs. alternative), the Pages base-path handling, the
link-check tool, how the shared `docs/*.md` repo-relative links are kept valid both on
GitHub and on the site, and the exact Quickstart step list.

## Risks / Rollback

The main risk is **drift**: the Quickstart silently diverging from the real `looper
login` / `looper init` behavior (0077 / 0007) as those commands evolve — mitigated by
linking the canonical walkthroughs instead of duplicating command surfaces, and by
0061's example attachment doubling as an executable check that the Quickstart still
works. A wrong Pages `base` path 404s assets — caught by testing the *built* output in
CI. Rollback is trivial: docs are additive files plus one workflow; reverting the
branch removes the site with no runtime impact.

## Final Summary

Fill this in before marking verified.
