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

Releases are cut by the two-stage pipeline in
`.github/workflows/release.yml` (version PR → publish on merge). The publish
job authenticates to npm via **OIDC trusted publishing** — no stored token; see
`SECURITY.md`. Manual fallback (maintainers): `npm run build && npx changeset
publish` while logged in (`npm login`), then `git push --follow-tags`.

## Flaky tests

Never delete a flaky test. Quarantine it with `it.skip` plus a comment
`// QUARANTINE(<issue-url>): <reason>` and open an issue labeled
`flaky-test`; the skip list is greppable via `QUARANTINE(`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
