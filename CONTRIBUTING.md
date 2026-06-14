# Contributing to Loopdog

Thanks for your interest! Loopdog is early; the most valuable contributions right
now are issues describing real adoption needs, and PRs scoped to the active
roadmap.

## Ground rules

- Read [`AGENTS.md`](AGENTS.md) first — it holds the durable operating rules
  (they apply to human and agent contributors alike) and the planning protocol.
- Module boundaries are defined in [`docs/codebase.md`](docs/codebase.md).
  Import other packages only via their public barrel (`@loopdog/<name>`); the
  boundary check in CI enforces this.
- Non-trivial work gets a task file under `.agent/tasks/` per
  [`.agent/PLANS.md`](.agent/PLANS.md) before implementation.

## Dev setup

```bash
npm install      # Node 20+ required
npm run build    # tsc -b across the workspace
npm test         # vitest
npm run lint     # eslint + boundary check + prettier
```

All three must pass before a PR; CI runs the same commands.

## Branches & PRs

- Branch naming: `task/NNNN-short-slug` (see `AGENTS.md`).
- One task = one reviewable branch = one PR when possible.
- PRs need green CI (`lint`, `test`, `build`) and at least one approving
  review; paths listed in `.github/CODEOWNERS` additionally need an owner
  review.

## Releases & changesets

User-visible changes need a changeset:

```bash
npx changeset    # pick bump level + write a human note
```

### Choosing the bump (SemVer)

Loopdog follows [Semantic Versioning](https://semver.org). We are **pre-1.0**, and
`1.0.0` is a deliberate ship gate ([docs/release-checklist.md](docs/release-checklist.md)) —
changesets does **not** remap `major` for `0.x`, so a `major` changeset jumps
straight to `1.0.0`. Pick the bump accordingly:

| Your change | Pre-1.0 bump (now) | Post-1.0 bump |
|---|---|---|
| Backwards-compatible — new feature/flag/command, enhancement, **or** bug fix | **`patch`** (`0.x.`**`Y`**) | `minor` (feature) · `patch` (fix) |
| Backwards-incompatible — changed/removed config field, renamed/removed command or flag, behavior an adopter must adapt to | **`minor`** (`0.`**`X`**`.0`) | `major` |
| The deliberate `1.0.0` ship gate | _(don't — see the release checklist)_ | a single `major` |
| Docs-only, tests-only, or an internal refactor with no user-visible effect | **no changeset** | no changeset |

Rules of thumb:

- **Default to `patch`.** Reserve `minor` for a change that forces an adopter to
  do something differently.
- **Never use `major` casually pre-1.0** — it bumps straight to `1.0.0`, which is
  gated on the [release checklist](docs/release-checklist.md).
- One changeset per PR; its note is the user-facing changelog line.
- When you merge the "Version Packages" PR, don't merge other PRs at the same
  time — a concurrent merge can leave a changeset behind, and the pipeline then
  opens another version PR instead of publishing.

Releases are cut by the two-stage pipeline in
`.github/workflows/release.yml` (version PR → publish on merge). The publish
job authenticates to npm via **OIDC trusted publishing** — no stored token; see
`SECURITY.md`. Manual fallback (maintainers): `npm run build && npx changeset
publish` while logged in (`npm login`), then `git push --follow-tags`.

**One-time repo setting (maintainers):** enable **Settings → Actions → General →
Workflow permissions → "Allow GitHub Actions to create and approve pull
requests"**. Without it the version-PR stage fails with _"GitHub Actions is not
permitted to create or approve pull requests."_ It only affects loopdog's own
release pipeline; adopters never need it (the controller doesn't open or approve
PRs — the provider work cells do, under their own identity).

## Flaky tests

Never delete a flaky test. Quarantine it with `it.skip` plus a comment
`// QUARANTINE(<issue-url>): <reason>` and open an issue labeled
`flaky-test`; the skip list is greppable via `QUARANTINE(`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
