# Install

Loopdog ships as the `@loopdog/cli` npm package + the versioned reusable workflows
the CLI scaffolds into your repo.

## Install the CLI

```bash
npm i -g @loopdog/cli      # or: npx @loopdog/cli <command>
loopdog --version          # should report the installed version
```

## Attach a repo

```bash
loopdog login              # import your Claude/Codex subscription (nothing pasted)
loopdog connect            # confirm the GitHub repo + identity
loopdog init               # scaffold .loopdog/ + the workflow callers (safe, dry-run)
```

Then follow the [Quickstart](quickstart.md) (open a test issue → watch groom →
`loopdog promote groom --to act`). The full attach flow and what's safe are in the
quickstart; the trust model is in [Security & Trust](security.md).

## Pinning the workflows

The scaffolded workflow callers reference Loopdog's reusable workflows by tag.
Pin either:

- **`@v1`** — a floating tag that tracks the latest `1.x` (gets fixes); or
- **`@v1.0.0`** — an exact pin (fully reproducible, no auto-updates).

```yaml
# .github/workflows/loopdog-events.yml (scaffolded)
uses: <org>/loopdog/.github/workflows/reusable-events.yml@v1   # or @v1.0.0
```

## Upgrading

`loopdog upgrade` migrates an attached `.loopdog/` tree forward when a new Loopdog
changes the config contract — see [UPGRADING.md](UPGRADING.md). The controller
refuses to run config newer than it understands, so a version mismatch fails
loudly rather than misbehaving.

> Publishing `@loopdog/cli` to npm with provenance + cutting the `v1.0.0` /
> floating `v1` tags is the release step (see
> [release-checklist.md](release-checklist.md)); until 1.0.0 is cut, install from
> the `0.x` channel / a local build.
