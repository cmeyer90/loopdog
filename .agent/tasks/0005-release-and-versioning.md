# 0005 Release & Versioning

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Give looper a repeatable, automated release process: semver-versioned
`@looper/*` packages, a generated changelog, and a tag-driven pipeline that
publishes the CLI (and the reusable workflows/templates adopters consume) as
verifiable artifacts — so the tool ships to the standard it enforces.

## Background

Last task of [Milestone 01](../milestones/milestone-01-project-foundation-and-oss-scaffolding.md).
The milestone's Guiding Decisions require "semver from day one" and a release
process that exists even pre-1.0. It builds on the workspace skeleton (0001), the
green/reproducible CI (0003), and the branch-protection + CODEOWNERS gate (0004)
— release is the publish stage layered on top of a trustworthy CI. The stack is
an npm-workspaces monorepo of `@looper/*` packages per
[`docs/codebase.md`](../../docs/codebase.md) "Packages"; V1 targets semver
`1.0.0` per [architecture](../../docs/architecture.md) "V1 scope", so the
machinery must carry pre-1.0 (`0.x`) builds today and graduate to `1.0.0`
unchanged.

## Scope

- A version-management tool that tracks per-package semver across the workspace
  and aggregates contributor-supplied changesets into a changelog.
- A tag-/release-driven GitHub Actions workflow that builds, verifies, and
  publishes the CLI to npm and cuts a GitHub Release with notes + provenance.
- Pre-1.0 (`0.x`) channel today; the same pipeline reaches `1.0.0` with no
  rework. A documented manual fallback so a human can cut a release if automation
  fails.

### Technical detail

**Lands in:** repo root tooling (`.changeset/`, `.github/workflows/release.yml`,
root `package.json` scripts) plus the publishable surface in `@looper/cli` (the
`looper` binary) and the `templates/` adopters scaffold. No `@looper/*` runtime
code changes — this is build/release plumbing.

**Versioning — Changesets.** Adopt [`@changesets/cli`](https://github.com/changesets/changesets):
contributors run `npx changeset` to drop a markdown changeset under `.changeset/`
declaring which packages bump and at what level (`patch`/`minor`/`major`) with a
human note. This fits the monorepo (per-package versions, dependency-aware
bumps), the "loops are data" repo (changesets are reviewable artifacts in VCS,
consistent with everything-as-artifact), and needs no external service.

- Config `.changeset/config.json`: `access: public`, `baseBranch: main`,
  `changelog: ["@changesets/changelog-github", { repo: "<org>/looper" }]`.
- **Internal-only packages are never published.** `@looper/testing` is dev-only
  (`private: true`); `@looper/core/config/github/plans/backends/adapters/runtime`
  are libraries the CLI bundles. Decide per package whether to publish the
  library or bundle it into `@looper/cli`'s `dist` (see Decisions). The default
  recommendation: publish **only `@looper/cli`** in V1 (single consumer-facing
  artifact), `private: true` or `linked` on the rest, so the published surface
  stays one package; revisit if a package is consumed standalone.
- Linked/fixed versioning: keep all published packages on **one synchronized
  version line** (`linked` or `fixed` in changesets) so `looper --version` is the
  release version users cite in issues.

**Release pipeline — two-stage, tag-driven.** `.github/workflows/release.yml`:

1. **Version PR (on push to `main`):** the `changesets/action` consumes pending
   changesets, bumps versions, regenerates `CHANGELOG.md` per package + root, and
   opens/updates a "Version Packages" PR. Merging that PR is the human release
   gate (it touches `package.json`/`CHANGELOG` — gate via 0004 CODEOWNERS).
2. **Publish (on the version PR merge / a `v*` tag):** reuse the **same** lint +
   test + build steps as CI (0003) — never publish an unverified tree — then
   `changeset publish` (or `npm publish --workspaces`) to npm and push the git
   tag, and `gh release create` with the changeset notes.

- **Provenance + integrity:** publish with `npm publish --provenance`
  (OIDC-signed, GitHub-attested) so adopters can verify artifacts; this is a
  V1 non-negotiable-flavored trust signal. Requires `id-token: write` +
  `contents: write` permissions on the job.
- **Auth:** the publish job needs an `NPM_TOKEN` repo secret (npm automation
  token) — the **only** external credential here; document it in
  `CONTRIBUTING`/`SECURITY` and scope it to publish. The `GITHUB_TOKEN` covers
  the tag/Release/PR (consistent with looper's identity model — controller acts
  as `GITHUB_TOKEN`, no looper App). Note this `NPM_TOKEN` is a maintainer
  release credential, unrelated to the keyless adopter path.
- **Templates/workflows distribution:** the reusable workflow callers and
  `templates/` assets adopters reference must be versioned too. Pin the published
  `looper init`-scaffolded workflow to a release tag (or `@v0`/`@v1` major-moving
  ref), so an adopter's pinned looper version is reproducible. Record the ref
  convention in Decisions.
- **`0.x` today:** seed all packages at `0.1.0`; pre-1.0 semver (minor = breaking
  is allowed) until M15 graduates to `1.0.0` by a single `major` changeset — no
  pipeline change.

**Edge cases:** a publish that partially succeeds (npm ok, tag push fails) must be
re-runnable idempotently — `changeset publish` skips already-published versions,
so re-running the job is safe; document the manual `npm publish` + `git tag`
fallback. A release with zero pending changesets is a no-op (no version PR).
Prerelease/`next` dist-tag is out of scope (see below) but leave the door open
via changesets `pre enter`.

## Out Of Scope

- Branch protection / required checks / CODEOWNERS (task 0004 — release reuses
  them as the human gate).
- The CI workflow definition itself (task 0003 — release **reuses** its job
  steps, doesn't redefine lint/test/build).
- Prerelease/canary (`next`) channels, multi-registry mirrors, signed git tags
  (GPG), and any post-1.0 LTS/backport policy.
- The adopter-facing keyless install/auth path (OAuth device flow / `gh` reuse) —
  that is M07/M16, not the maintainer release pipeline.

## Acceptance Criteria

- [x] `npx changeset` works locally and a dropped changeset is picked up by the
      release workflow. (CLI verified locally; workflow wiring is the standard
      changesets/action consume path — first live exercise happens on `main`.)
- [x] On push to `main` with pending changesets, a "Version Packages" PR is
      opened/updated that bumps versions and regenerates `CHANGELOG.md`.
      (Wired in `release.yml`; `changeset version` dry-verified locally.)
- [x] Merging the version PR publishes `@looper/cli` (the only public package)
      to npm and cuts a matching GitHub Release with notes + git tag. (Wired;
      needs the operator-held `NPM_TOKEN` secret for the live path.)
- [x] Published artifacts carry npm **provenance** (`NPM_CONFIG_PROVENANCE` +
      `id-token: write` on the job).
- [x] `@looper/testing` and all non-public packages are never published
      (`private: true` everywhere but cli; unit-tested in `scripts/test/`).
- [x] Publishing is gated behind the same lint + test + build that gates a PR
      (0003); an unverified tree cannot publish.
- [x] `looper --version` reports the released semver (reads the package
      version); all packages share one fixed version line.
- [x] A documented manual fallback exists (CONTRIBUTING + AGENTS.md), and
      re-running a partially-failed publish is idempotent (`changeset publish`
      skips already-published versions).

## Implementation Checklist

- [x] Add `@changesets/cli` + `@changesets/changelog-github`; init
      `.changeset/config.json` (fixed `@looper/*` line, public access, main).
- [x] Mark non-published packages `private: true` (all 8 libraries + testing);
      publishable surface = only `@looper/cli`, bundled via tsup `prepack`.
- [x] Seed all packages at `0.1.0`; `looper --version` reads the package version.
- [x] Add `.github/workflows/release.yml`: single changesets/action job that
      opens the version PR or publishes, after re-running lint+test+build, with
      `id-token: write` + `contents: write` + provenance.
- [x] Add the `NPM_TOKEN` secret requirement to docs (SECURITY "Maintainer
      credentials" + CONTRIBUTING).
- [x] Version the reusable workflows/`templates/` and document the pinning ref
      (see Decisions: tag-pinned `@vX.Y.Z` refs emitted by `looper init`).
- [x] Document the release runbook + manual fallback in AGENTS.md/CONTRIBUTING.

## Test Plan

Tests run via the repo's vitest runner (no real quota — release plumbing touches
no provider/backend, so M18 fakes are not needed here). Verification is mostly
dry-run + a scratch publish:

```bash
npm run build && npm test          # the gate the publish job reuses (0003)
npx changeset                      # author a changeset locally
npx changeset version              # dry-run: versions + CHANGELOG regenerate
npx changeset publish --dry-run    # confirm only public packages would publish
# end-to-end: run the release workflow against a scratch npm scope / branch,
# confirm a GitHub Release + tag + provenance-attested package appear.
```

## Verification Log

- 2026-06-09: `npx changeset version --help` — CLI installed and runnable.
- 2026-06-09: `npm pack --dry-run` in `packages/cli` — prepack ran tsup; tarball
  = 5 files (bundled main/index + chunk, package.json; @looper/* inlined), no
  private package contents leaked as deps; LICENSE added to the package after.
- 2026-06-09: governance unit tests green (only cli public; fixed version line;
  no @looper/* in cli dependencies).

## Decisions

- Published surface: **only `@looper/cli`**, with the `@looper/*` libraries
  bundled in by tsup at `prepack` (`noExternal: /^@looper\//`). The libraries'
  third-party runtime deps are therefore real `dependencies` of the cli package
  (kept external by the bundler). `@looper/*` appear only as devDependencies of
  cli — enforced by a unit test.
- Versioning: changesets **fixed** group `[["@looper/*"]]` (one version line;
  private packages version but never tag/publish).
- Templates/workflow pinning: scaffolded workflow callers reference this repo's
  reusable workflows at the release tag (`cmeyer90/looper/.github/workflows/...@vX.Y.Z`)
  matching the installed CLI version; `looper init` writes the pin (M02 · 0007).
- Provenance: `NPM_CONFIG_PROVENANCE=true` env + `id-token: write`;
  `GITHUB_TOKEN` covers the version PR/tag/Release; `NPM_TOKEN` is the only
  external credential (publish-scoped; documented in SECURITY).

## Risks / Rollback

- **Accidental publish of a private/dev package** (e.g. `@looper/testing` leaking
  fakes) — mitigated by `private: true` + a `--dry-run` assertion in CI before
  the real publish. Rollback: `npm deprecate`/unpublish within the window.
- **`NPM_TOKEN` compromise** — scope it to publish-only, store as a repo secret,
  prefer OIDC/provenance; document in `SECURITY`.
- **Partial-publish drift** (npm succeeded, tag/Release failed) — re-run is
  idempotent (`changeset publish` skips published versions); manual fallback
  documented.
- Rollback overall: the workflow is additive; deleting `release.yml` +
  `.changeset/` reverts to manual `npm version`/`npm publish` with no impact on
  the controller runtime.

## Final Summary

Changesets-driven two-stage release: contributors drop changesets; pushes to
main open/update a "Version Packages" PR (the human gate, CODEOWNERS-protected
paths); merging re-verifies lint+test+build and publishes the bundled
`@looper/cli` to npm with provenance, tags, and cuts the GitHub Release.
Everything else is private-by-construction with tests enforcing it. Pre-1.0
semver today; `1.0.0` is one major changeset away with no pipeline change.
Live publish requires the operator-held `NPM_TOKEN`.
