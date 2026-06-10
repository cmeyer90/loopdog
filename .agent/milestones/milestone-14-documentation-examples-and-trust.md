# Milestone 14: Documentation, Examples & Trust

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — design tenets
> and V1 scope. This is the adoption surface for an open-source tool.

## Objective

Make looper adoptable and trustworthy: a docs site with quickstart and full
config/adapter/provider references, runnable example attachments, and a published
security & trust model — so a new maintainer can attach looper safely in minutes.

## Guiding Decisions

- Docs are a first-class deliverable, not an afterthought; the quickstart is the
  product's first impression.
- A real example attachment (in this repo or a sibling demo repo) doubles as a
  dogfood and a copyable template.
- Trust is earned with an explicit threat model and a clear statement of what
  looper can and cannot do to a repo.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0058 | planned | task/0058-docs-site-and-quickstart | Docs Site & Quickstart | A docs site with a 10-minute attach quickstart. |
| 0059 | planned | task/0059-config-reference | Config Reference | Complete `looper.yml` reference with examples. |
| 0060 | planned | task/0060-authoring-guides | Adapter & Provider Authoring Guides | How-tos for writing project adapters and model providers. |
| 0061 | planned | task/0061-example-attachments | Example Attachments | One or more runnable example repos looper is attached to. |
| 0062 | planned | task/0062-security-and-trust-model | Security & Trust Model | Published threat model + permission/blast-radius guarantees, incl. subscription-driving, provider-cloud secret residency, and the ToS question. |

## Definition Of Done

- A docs site covers quickstart, full config reference, and authoring guides.
- At least one runnable example attachment exists and is referenced from the
  quickstart.
- A security & trust document states looper's permissions, guarantees, and threat
  model.

## Verification Log

Add dated entries as tasks land.
