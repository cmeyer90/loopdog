# Upgrading Loopdog

Loopdog's attached `.loopdog/` tree carries a config **`version`**. The controller
refuses to run config it doesn't understand, and `loopdog upgrade` lifts an older
tree forward by applying ordered, idempotent migrations.

## The version contract

- `CONFIG_VERSION` — the version this Loopdog understands (currently **1**).
- `MIN_MIGRATABLE_FROM` — the oldest on-disk version `loopdog upgrade` can migrate
  from (currently **1**).
- The runtime classifies an on-disk `version`:

  | On-disk | Status | Behavior |
  |---|---|---|
  | `== CONFIG_VERSION` | current | runs normally |
  | in `[MIN_MIGRATABLE_FROM, CONFIG_VERSION)` | behind | runs with an upgrade nudge; `loopdog upgrade` migrates it |
  | `> CONFIG_VERSION` | ahead | **refused** — upgrade Loopdog, don't downgrade the config |
  | `< MIN_MIGRATABLE_FROM` | too-old | **refused** — re-scaffold with `loopdog init` |

## `loopdog upgrade`

```bash
loopdog upgrade --dry-run     # preview the migrations + a per-file changed/conflict table; writes nothing
loopdog upgrade               # apply; review + commit the diff
```

- **Idempotent** — re-running on an already-current tree is a no-op ("up to date").
- **Never silently overwrites** an adopter-edited file — a conflicting migration
  writes a `.loopdog-new` sidecar and reports it for manual merge.
- **Refuses** a downgrade (newer on-disk) or a too-old tree with an actionable
  message.
- **Re-syncs the controller's version pins.** `upgrade` also rewrites the
  scaffolded caller workflows (`.github/workflows/loopdog-*.yml`) to the floating
  major — `uses: …/reusable-*.yml@vN` and `loopdog-version: 'N'` — so a repo
  scaffolded by an older Loopdog (which wrote exact `@<sha>` / `0.x.y` pins that
  never move) stops silently running a stale controller. This runs **even when
  the config is already current**, since the workflow pins drift independently of
  the config `version`. New installs already float, so they auto-track every
  release with no action; one `loopdog upgrade` converts a legacy exact-pinned
  repo to the same auto-tracking. (Prefer reproducibility over auto-tracking?
  `upgrade` floats the pins by design — re-pin to an exact `@vX.Y.Z` /
  `loopdog-version: X.Y.Z` by hand afterward, and skip `upgrade` on future
  releases.) Preview it with `--dry-run`.

## Migration log

One entry per migration as the version line advances.

| From → To | Description |
|---|---|
| _(none yet)_ | Version **1** is the baseline. |

When `CONFIG_VERSION` advances to 2, a single registry entry (`from: 1, to: 2`)
is added with its transform, and this table gains a row. The chain is gap-checked
at load — a missing step is a hard error, never a silent skip.
