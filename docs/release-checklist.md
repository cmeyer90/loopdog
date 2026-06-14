# Release Checklist — 1.0.0

The ship gate. `1.0.0` means the attach flow, the four loops, both providers
(Claude + Codex), and the generic adapter work on a repo Loopdog's authors don't
control. Each line links its evidence; the act of publishing is gated on all of
them. Release *machinery* (changesets/CI publish) is task 0005; this is the gate.

## Gate

- [ ] **External dogfood (0063)** green — a real external repo driven groom→merge
      on real Claude **and** Codex, cross-provider review both directions, edge
      cases per spec. Evidence: [dogfood/0063-report.md](dogfood/0063-report.md)
      go-verdict + per-issue run records. _(operator-pending — needs the live run)_
- [x] **Security review (0064)** — no unresolved critical/high in the three
      surfaces; each fixed-with-test or accepted-by-design. Evidence:
      [security-review.md](security-review.md). _(independent third-party review
      still an operator step.)_
- [ ] **Benchmarks (0065)** published from the dogfood window. Evidence:
      [benchmarks.md](benchmarks.md) (the `loopdog bench` mechanism is verified
      offline; numbers await the dogfood). _(operator-pending — needs live data.)_
- [x] **Upgrade path (0067)** — versioned config contract + `loopdog upgrade` +
      the runtime version gate. Evidence: [UPGRADING.md](UPGRADING.md),
      `packages/config/test/migrate.test.ts`.
- [x] **V1 non-negotiables** — subscription path, human-gated default, secret
      hygiene, un-editable gates, documented trust boundary. Evidence:
      [security.md](security.md), [trust-boundary.md](trust-boundary.md).
- [x] **Docs cold-followable** — quickstart + install verified against the
      structure of the example attachment. Evidence: [quickstart.md](quickstart.md),
      [install.md](install.md), [examples.md](examples.md). _(a cold read by
      someone who didn't write them, on the 0063 repo, is the final check.)_

## Publish (machinery — task 0005 + operator)

- [ ] A single `major` changeset bumps the `@loopdog/*` line to `1.0.0`.
- [ ] The pipeline publishes `@loopdog/cli@1.0.0` with npm provenance.
- [ ] A `v1.0.0` GitHub Release is cut with notes enumerating breaking changes
      since the last `0.x`.
- [ ] A floating `v1` tag points at `v1.0.0`; scaffolded workflows reference `@v1`.
- [ ] `loopdog --version` reports `1.0.0`; all published packages share the line.
- [ ] The publish gate (CI) is green on the released tree.

> **Status: release-prep complete, publish operator-pending.** The implementable
> gate items (security review, upgrade path, non-negotiables, docs) are done and
> evidenced; the live-dogfood + benchmark-numbers + npm-publish steps require an
> operator with a real repo, real subscriptions, and publish credentials.
