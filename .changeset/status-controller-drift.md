---
'@loopdog/cli': minor
---

`loopdog status` now flags controller-version drift, so updating the CLI no
longer leaves a stale controller running silently. When the `@loopdog/cli`
version your caller workflows pin (`loopdog-version`) is an exact version older
than the CLI you have installed, status shows a one-line nudge —
`⚠ controller pinned v0.2.0 · CLI v0.4.0 — run loopdog upgrade to re-sync` — and
the `--json` output gains a `controller` field. Floating pins (which auto-track)
and current pins render nothing; the check is read locally and best-effort, so it
works even when the live GitHub fetch is unavailable. Pairs with `loopdog
upgrade` re-syncing the pins: status tells you when, upgrade does it.
