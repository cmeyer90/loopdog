# Milestone 14: Documentation, Examples & Trust

Status: verified

> Background: [Loopdog Architecture](../../docs/architecture.md) — design tenets
> and V1 scope. This is the adoption surface for an open-source tool.

## Objective

Make loopdog adoptable and trustworthy: a docs site with quickstart and full
config/adapter/provider references, runnable example attachments, and a published
security & trust model — so a new maintainer can attach loopdog safely in minutes.

## Guiding Decisions

- Docs are a first-class deliverable, not an afterthought; the quickstart is the
  product's first impression.
- A real example attachment (in this repo or a sibling demo repo) doubles as a
  dogfood and a copyable template.
- Trust is earned with an explicit threat model and a clear statement of what
  loopdog can and cannot do to a repo.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0058 | verified | task/0058-docs-site-and-quickstart | Docs Site & Quickstart | `docs/README.md` hub + `docs/quickstart.md` (10-min keyless attach). SSG/Pages/link-check CI deferred. |
| 0059 | verified | task/0059-config-reference | Config Reference | `docs/config-reference.md` — every root + loop field + precedence + edge cases. Schema-generator deferred. |
| 0060 | verified | task/0060-authoring-guides | Adapter & Provider Authoring Guides | `docs/guides/{adapters,providers}.md` with real APIs + conformance snippets; `docs/adapters.md` redirects. |
| 0061 | verified | task/0061-example-attachments | Example Attachments | `examples/node-todo/` (real app + attachment), schema-validated + scenario-tested to a golden offline. |
| 0062 | verified | task/0062-security-and-trust-model | Security & Trust Model | `docs/security.md` — trust model, permission inventory, blast-radius table, threat model, residency, ToS. |

## Definition Of Done

- A docs site covers quickstart, full config reference, and authoring guides.
- At least one runnable example attachment exists and is referenced from the
  quickstart.
- A security & trust document states loopdog's permissions, guarantees, and threat
  model.

## Verification Log

- 2026-06-12: M14 complete (0058–0062 verified). The adoption surface is in
  place: a `docs/` hub (`README.md` index + `quickstart.md` 10-min keyless attach),
  a complete `config-reference.md` (every root + loop field, precedence, edge
  cases), two authoring guides (`guides/adapters.md` canonical + `guides/
  providers.md`, real `@loopdog/core` APIs + the actual conformance entrypoints;
  `adapters.md` redirects), a runnable `examples/node-todo/` attachment (real app
  `node --test` green + `.loopdog/` from the templates, schema-validated and
  scenario-tested to a committed golden offline), and `security.md` (trust model,
  permission inventory, blast-radius table, threat model, residency 0032, ToS
  0092, disclosure). All internal links resolve; repo-wide 244 tests green, lint
  clean. Deferred as lower-priority CI tooling (per the project's "CI is lower
  priority" stance): the static-site generator (`docs:build`) + GitHub Pages
  deploy + CI link-check (0058), and the schema-walking config generator +
  `--check` drift guard (0059). The markdown docs are the publishable source.
