# Milestone 15: V1 Hardening & Release

Status: planned

> Background: [Looper Architecture](../../docs/architecture.md) — "V1 scope."
> The integration, dogfood, and ship gate. Depends on all prior milestones.

## Objective

Prove looper end-to-end on a real external repository, harden it (security,
performance, cost), and ship `1.0.0`: published artifacts, an upgrade path, and a
quickstart that actually works on a stranger's repo.

## Guiding Decisions

- V1 is gated on a real, non-trivial external dogfood — not internal tests alone.
- Security review precedes release; the merge loop stays human-gated on the
  dogfood until the verification ladder is proven there.
- `1.0.0` means the attach flow, the four loops, providers (Claude + Codex), and
  the generic adapter all work on a repo looper's authors don't control.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0063 | planned | task/0063-end-to-end-dogfood | End-to-End External Dogfood | Looper attached to ≥1 real external repo on real Claude/Codex subscriptions, driving issues to merge. |
| 0064 | planned | task/0064-security-review | Security Review | Independent review of permissions, secret handling, and injection surface. |
| 0065 | planned | task/0065-cost-latency-benchmarks | Cost & Latency Benchmarks | Per-loop cost/latency/success benchmarks with published numbers. |
| 0066 | planned | task/0066-release-1-0-0 | Release 1.0.0 | Semver 1.0.0 tag, published artifacts, install instructions. |
| 0067 | planned | task/0067-upgrade-and-migration-path | Upgrade & Migration Path | Versioned config + documented upgrade path for adopters. |

## Definition Of Done

- Looper drives at least one real external repo's issues through groom →
  implement → review → merge (→ deploy where applicable).
- A security review has passed and findings are resolved or documented.
- Cost/latency/success benchmarks are published.
- `1.0.0` is tagged and installable, with a documented upgrade path.

## Verification Log

Add dated entries as tasks land.
