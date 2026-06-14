---
'@loopdog/cli': minor
---

`loopdog upgrade` now also re-syncs the scaffolded controller workflows' version
pins, so an attached repo stops silently running a stale (and possibly buggy)
controller after a Loopdog release.

loopdog is zero-infra and can't push updates into an adopter repo, so a caller
workflow only stays current if it **floats** on the major tag the release
pipeline keeps moving (`uses: …/reusable-*.yml@vN`, `loopdog-version: 'N'`). New
installs already float. But repos scaffolded by an older Loopdog carry **exact**
pins (`@<sha>` / `0.x.y`) that never move, and nothing re-synced them — `upgrade`
only touched the `.loopdog/` config tree and `init` won't overwrite existing
workflow files.

`upgrade` now rewrites `.github/workflows/loopdog-*.yml` to the floating major
(owner/repo, secrets, and trailing comments preserved; non-loopdog workflows and
the custom deploy workflow untouched). It runs **even when the config is already
current** — pin drift is independent of the config `version` — and honors
`--dry-run`. One upgrade converts a legacy exact-pinned install to auto-tracking.
