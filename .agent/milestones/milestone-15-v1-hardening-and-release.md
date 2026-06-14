# Milestone 15: V1 Hardening & Release

Status: implemented

> Background: [Loopdog Architecture](../../docs/architecture.md) — "V1 scope."
> The integration, dogfood, and ship gate. Depends on all prior milestones.

## Objective

Prove loopdog end-to-end on a real external repository, harden it (security,
performance, cost), and ship `1.0.0`: published artifacts, an upgrade path, and a
quickstart that actually works on a stranger's repo.

## Guiding Decisions

- V1 is gated on a real, non-trivial external dogfood — not internal tests alone.
- Security review precedes release; the merge loop stays human-gated on the
  dogfood until the verification ladder is proven there.
- `1.0.0` means the attach flow, the four loops, providers (Claude + Codex), and
  the generic adapter all work on a repo loopdog's authors don't control.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0063 | implemented | task/0063-end-to-end-dogfood | End-to-End External Dogfood | Runbook + report template + offline structural proxy (M18 sim + example); live run operator-pending. |
| 0064 | verified | task/0064-security-review | Security Review | `docs/security-review.md` — 3 surfaces dispositioned + a NEW brief untrusted-input preamble & regression test. |
| 0065 | implemented | task/0065-cost-latency-benchmarks | Cost & Latency Benchmarks | `projectBenchmark` + `loopdog bench` + `docs/benchmarks.md`; numbers operator-pending (need a live ledger). |
| 0066 | implemented | task/0066-release-1-0-0 | Release 1.0.0 | `docs/release-checklist.md` + `docs/install.md` + non-negotiables; publish operator-pending. |
| 0067 | verified | task/0067-upgrade-and-migration-path | Upgrade & Migration Path | Version contract + migration registry + `loopdog upgrade` + `docs/UPGRADING.md`. |

## Definition Of Done

- Loopdog drives at least one real external repo's issues through groom →
  implement → review → merge (→ deploy where applicable).
- A security review has passed and findings are resolved or documented.
- Cost/latency/success benchmarks are published.
- `1.0.0` is tagged and installable, with a documented upgrade path.

## Verification Log

- 2026-06-12: M15 **implemented** — everything an offline agent can build + verify
  is done; the inherently-live gates are operator-pending. Verified offline:
  the security review (0064 — three surfaces dispositioned, a NEW brief
  untrusted-input preamble + injection regression test, least-privilege workflows,
  the tested scrubber + authz-park), and the upgrade path (0067 — version contract
  + gap-checked migration registry + `loopdog upgrade` + `docs/UPGRADING.md`, all
  unit-tested). Implemented with mechanism verified but live data/publish pending:
  benchmarks (0065 — `projectBenchmark` + `loopdog bench` + `docs/benchmarks.md`,
  tested offline; numbers need a live ledger), the dogfood (0063 — runbook + report
  template + the M18/example offline proxy; the live external run is operator-only),
  and the 1.0.0 release (0066 — checklist + install docs + non-negotiables; the npm
  publish + tags need credentials + CI + the dogfood). Repo-wide 254 tests across
  36 files green, lint + build clean, all doc links resolve.
  **The only remaining gates are operator-only** (a live external dogfood on real
  Claude/Codex subscriptions, the resulting benchmark numbers, an independent
  security review, and the npm publish) — exactly the class of work deferred at
  M00 for the same reason.
