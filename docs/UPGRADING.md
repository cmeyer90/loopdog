# Upgrading Looper

Looper's attached `.looper/` tree carries a config **`version`**. The controller
refuses to run config it doesn't understand, and `looper upgrade` lifts an older
tree forward by applying ordered, idempotent migrations.

## The version contract

- `CONFIG_VERSION` — the version this Looper understands (currently **1**).
- `MIN_MIGRATABLE_FROM` — the oldest on-disk version `looper upgrade` can migrate
  from (currently **1**).
- The runtime classifies an on-disk `version`:

  | On-disk | Status | Behavior |
  |---|---|---|
  | `== CONFIG_VERSION` | current | runs normally |
  | in `[MIN_MIGRATABLE_FROM, CONFIG_VERSION)` | behind | runs with an upgrade nudge; `looper upgrade` migrates it |
  | `> CONFIG_VERSION` | ahead | **refused** — upgrade Looper, don't downgrade the config |
  | `< MIN_MIGRATABLE_FROM` | too-old | **refused** — re-scaffold with `looper init` |

## `looper upgrade`

```bash
looper upgrade --dry-run     # preview the migrations + a per-file changed/conflict table; writes nothing
looper upgrade               # apply; review + commit the diff
```

- **Idempotent** — re-running on an already-current tree is a no-op ("up to date").
- **Never silently overwrites** an adopter-edited file — a conflicting migration
  writes a `.looper-new` sidecar and reports it for manual merge.
- **Refuses** a downgrade (newer on-disk) or a too-old tree with an actionable
  message.

## Migration log

One entry per migration as the version line advances.

| From → To | Description |
|---|---|
| _(none yet)_ | Version **1** is the baseline. |

When `CONFIG_VERSION` advances to 2, a single registry entry (`from: 1, to: 2`)
is added with its transform, and this table gains a row. The chain is gap-checked
at load — a missing step is a hard error, never a silent skip.
