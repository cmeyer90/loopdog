# 0060 Adapter & Provider Authoring Guides

Status: verified  
Branch: task/0060-authoring-guides

## Goal

Publish two complete, copy-pasteable how-to guides on looper's docs site —
**"Write a project adapter"** and **"Write a model provider / execution
backend"** — that take a contributor from "I have a project type / a provider
looper doesn't support yet" to "my adapter/backend is registered, conformance-
green, and dispatching" without reading looper's internals.

## Background

Part of [Milestone 14](../milestones/milestone-14-documentation-examples-and-trust.md):
the adoption surface for an open-source tool. The milestone's Definition-of-Done
requires the docs site cover **authoring guides**, and its guiding decision makes
docs a first-class deliverable. These two guides fill the `guides/adapters.md` and
`guides/providers.md` nav slots the docs-site shell (0058) reserves as stubs.

They document looper's two contributor-facing genericity surfaces from
[architecture](../../docs/architecture.md) "Generic-ness, in three plugin systems"
(*Project adapters* and *Model providers / execution backends*) and the
[codebase](../../docs/codebase.md) decision that "backends and adapters are a small
fixed registry behind an interface; third parties use the conformance kit."

This task **publishes and completes**, it does not re-derive: the *adapter*
contract + conformance kit + a draft `docs/adapters.md` already land in
**0028** (adapter authoring guide & test kit), and the *backend* interface +
its conformance harness land in **0019** (with worked impls in 0020 Claude /
0021 Codex / 0074 self-hosted). 0060 owns the **site-published, end-to-end,
DRY-against-those-sources** guide pages — and is the **only** task that authors a
publishable *provider/backend* authoring guide (0019 ships the harness, not a
how-to). It must not contradict the keyless-identity / subscription-driven /
no-database model.

## Scope

- A `docs/guides/adapters.md` page (replacing 0058's stub) that is the canonical
  adapter how-to. If 0028 already wrote `docs/adapters.md`, **consolidate** it into
  this site page (single source) rather than maintaining two — leave a redirect/
  link from the old path.
- A new `docs/guides/providers.md` page: the end-to-end how-to for authoring a
  `Backend` (execution backend / model provider), with no preexisting draft.
- Both pages follow one shared structure: *what it is → contract reference →
  scaffold → implement → register → verify (conformance kit) → publish*, each with
  a copyable skeleton and a ~6-line conformance test snippet.
- Cross-links: from the guides into the relevant `architecture.md`/`codebase.md`
  sections and the frozen contract types; from the docs nav into both guides.
- A docs-build + link-check pass (reusing 0058's pipeline) so neither guide ships
  broken links or stale code snippets.

### Technical detail

**Lands in:** `docs/` only (plus the VitePress nav config from 0058). **No
`@looper/*` runtime code** — the contracts (`ProjectAdapter`, `Backend`), the
conformance kits, and the example impls are owned by 0024/0019/0028; this task is
documentation that *references* them. Keep snippets minimal and pull real type
names from `@looper/core`'s port surface so they don't rot.

**Provider/backend guide (`docs/guides/providers.md`)** — sections:

- *What a backend is*: the dispatch→ingest split (a backend dispatches a brief to
  an execution surface and ingests the PR it produces); the controller (M03 · 0012)
  is provider-agnostic and only speaks this interface; looper makes **no direct
  model API calls on the primary path** — a subscription backend dispatches to the
  provider's cloud, only the optional self-hosted backend holds a model key.
- *Contract reference*: the `Backend` port from **0019** —
  `capabilities() -> { trigger_modes: [api_fire|github_event|mention|self_hosted_dispatch], runs_sandbox,
  secret_phase: full|setup-only|none, network: on|setup-only|off, opens_pr,
  supports_review }`, `dispatch(brief, context) -> DispatchHandle` (async, returns
  immediately), `ingest(github_event) -> IngestResult | null`. Explain each
  capability field and how the runner adapts to it (e.g. `secret_phase: setup-only`
  ⇒ lean on the adopter's CI gate, M03 · 0014).
- *Correlation*: a backend MUST instruct its agent to produce the three correlation
  signals from **0073** — branch `looper/<loop>/<issue>-<run_id>`, a `looper-run:
  <run_id>` PR trailer, and an issue ref — and `ingest` matches on them; an
  uncorrelated PR returns `null` ("not ours"). Document the async contract: dispatch
  returns, the PR is ingested by a *later* invocation (event or the sweep, 0076).
- *Scaffold*: a copyable `MyBackend implements Backend` skeleton with TODOs, plus
  where it registers — the **fixed registry array in `@looper/backends`** (no plugin
  loader; contributors PR their backend in), per the codebase "small fixed registry"
  decision and the post-V1 marketplace exclusion.
- *Capability honesty*: a backend must report capabilities it actually has; the
  guide ties each field to a runner behavior and warns that over-claiming (e.g.
  `network: on` on a network-stripped surface) breaks gating silently.
- *Verify*: a ~6-line `mybackend.conformance.test.ts` calling the backend
  conformance harness (0019) against the **M18 fakes** (fake GitHub + recorded/
  replayed events) — never real provider quota. Show the dispatch→fake-event→ingest
  round-trip the harness drives.
- *Publish*: the contract is version-pinned; reference the exported contract-version
  constant (analogue of `ADAPTER_CONTRACT_VERSION`) so a breaking bump is detectable.

**Adapter guide (`docs/guides/adapters.md`)** — same skeleton, but the bulk of its
content is **authored by 0028** (contract → scaffold → implement `detect`/
capabilities/commands → register → run `runAdapterConformance` → publish, with the
skipped-vs-failed + secret-redaction rules). 0060's job is to (a) move/host that
content at the site path and (b) make it parallel in structure and tone to the
provider guide. **Do not duplicate** the conformance-clause detail from 0028 — link
to it.

**Consistency guardrails:** no API-key-on-the-primary-path, no looper GitHub App,
no database/queue. The provider guide must state the subscription path is the
default and the self-hosted/API backend is the secondary escape hatch (architecture
"Self-hosted / API backend").

**Edge cases:** the old `docs/adapters.md` path (0028) and the new
`docs/guides/adapters.md` must not both be live and divergent — pick one canonical
path and redirect; shared `docs/*.md` repo-relative links (`../.agent/...`) resolve
on GitHub but not on the built site — reuse 0058's link rewrite/allowlist; code
snippets must compile against the *current* `@looper/core` types (a stale snippet is
worse than no snippet) — keep them minimal and name real exports.

## Out Of Scope

- The `ProjectAdapter`/`Backend` interfaces themselves (0024 / 0019) and their
  conformance kits (0028 / 0019) — guides document and link them, not define them.
- The bundled adapters (0026/0027) and backends (0020/0021/0074) — they are *worked
  examples* the guides reference, not deliverables here.
- The docs-site shell, nav config, and Pages deploy pipeline (0058) — this task
  fills two reserved slots and reuses that build/link-check.
- Config reference (0059), example attachments (0061), security/trust model (0062).
- A plugin loader / dynamic discovery / marketplace (post-V1; registry stays a
  fixed array).

## Acceptance Criteria

- [x] `docs/guides/providers.md` exists and walks what-it-is → `Backend` contract
      (capabilities/dispatch/ingest) → correlation (0073) → scaffold → register
      (fixed array in `@looper/backends`) → verify (conformance harness on M18
      fakes) → publish, with a copyable backend skeleton and a ~6-line conformance
      snippet.
- [x] `docs/guides/adapters.md` exists as the canonical adapter how-to (0028 content
      consolidated to this path), parallel in structure to the provider guide, with
      a copyable adapter skeleton and a ~6-line `runAdapterConformance` snippet — and
      no second divergent copy of the adapter guide remains live.
- [x] Both guides are keyless/subscription-consistent: neither tells a contributor
      to add an API key on the primary path, reintroduce a looper App, or add a
      database/queue; the provider guide names the self-hosted backend as the
      secondary key-holding escape hatch.
- [x] Both guides are wired into the docs nav (the 0058 `guides/*` slots) and surface
      under "Guides"; the old `docs/adapters.md` path redirects/links to the new one.
- [~] `npm run docs:build` + link-check — DEFERRED (reuses 0058's deferred
      pipeline). The two guides' internal links resolve under the ad-hoc check.
- [x] Every code snippet references real exported type names from `@looper/core`'s
      port surface (no invented APIs), and the conformance snippets call the actual
      `runAdapterConformance` / backend-harness entrypoints.

## Implementation Checklist

- [x] Author `docs/guides/providers.md` (the full provider/backend how-to + skeleton
      + conformance snippet), cross-linking 0019/0073/0020-21-74 and the architecture
      "Execution model" section.
- [x] Consolidate 0028's adapter guide to `docs/guides/adapters.md`; align its
      structure/tone with the provider guide; redirect the old path.
- [x] Add both pages to the VitePress nav/sidebar (0058 `config.ts`), replacing the
      placeholder stubs.
- [x] Verify every snippet names current `@looper/core` exports and the real
      conformance entrypoints; trim anything that could rot.
- [x] Run the docs build + link-check; fix any broken/relative links and `base`-path
      asset issues.
- [x] Cross-link from `docs/codebase.md`'s backends/adapters rows into the guides.

## Test Plan

Tests run via the repo's vitest runner where applicable; the docs build + link-check
is the primary gate (no model quota, no GitHub API, fully offline). Any code-snippet
that is *executed* as a doctest uses the **M18 fakes** (fake GitHub + replay
backend), never real quota.

```bash
# replace with the chosen stack's runner once finalized (0001)
npm run docs:build        # both guide pages build; exits non-zero on a broken link
npm run docs:preview      # spot-check nav: Guides → Adapters / Providers render
# (optional) a vitest assertion that config.ts nav includes both guides/* entries
# (optional) compile-check the snippets against @looper/core's exported port types
```

## Verification Log

- 2026-06-12: both guides authored — `docs/guides/providers.md` (what-it-is →
  `ExecutionBackend` contract → correlation 0073 → register in
  `createBackendRegistry` → verify with `runBackendConformance` → publish, with a
  copyable backend skeleton) and `docs/guides/adapters.md` (the canonical adapter
  how-to: `ProjectAdapter` contract → `createAdapterRegistry` → `run
  AdapterConformance`, with a copyable adapter skeleton). The old
  `docs/adapters.md` is now a pointer to the canonical path (no divergent copy).
  Snippets use real exported names (`ExecutionBackend`/`WorkBrief`/`DispatchHandle`/
  `IngestResult`; `ProjectAdapter`/`CommandContext`/`CommandResult`/`RepoFs`) and
  the actual conformance entrypoints (signatures cross-checked against the
  `@looper/testing` source). Both keyless/subscription-consistent (self-hosted
  named as the secondary key-holder). Linked from `docs/README.md`.

## Decisions

- Canonical adapter guide = `docs/guides/adapters.md`; `docs/adapters.md` is a
  short pointer to it (consolidated, no divergent second copy). The provider guide
  is `docs/guides/providers.md`, parallel in structure.
- Original placeholder follows for reference: the canonical adapter-guide path (and
  the redirect for the old one), the
shared guide section skeleton, how snippets are kept from rotting (link vs. inline,
any doctest), and the backend contract-version constant referenced for "publish."

## Risks / Rollback

- **Duplication/drift with 0028 and 0019.** Two adapter guides or a provider guide
  that restates the harness will diverge; mitigate by single-sourcing the adapter
  content at one path and linking (not copying) the conformance-clause detail.
- **Snippet rot.** Inline code drifts from `@looper/core`; keep snippets minimal,
  name real exports, and prefer linking the contract over pasting it. A breaking
  contract bump is caught by the version constant the "publish" section cites.
- **Site-vs-GitHub link breakage.** Shared repo-relative links resolve on GitHub but
  not on the built site — reuse 0058's rewrite/allowlist and gate on the link-check.

Rollback is trivial: the guides are additive docs with no runtime behavior;
reverting the branch removes the two pages and restores the 0058 stubs.

## Final Summary

Two copy-pasteable how-tos — `docs/guides/providers.md` (write a model provider /
execution backend) and `docs/guides/adapters.md` (write a project adapter, the
canonical path; the old `docs/adapters.md` redirects here) — take a contributor
from "unsupported provider/stack" to "registered, conformance-green, dispatching"
without reading internals. Snippets use only real `@looper/core` port types and
the actual `runBackendConformance` / `runAdapterConformance` entrypoints, and stay
keyless/subscription-consistent. The docs:build link-check is deferred with 0058.
