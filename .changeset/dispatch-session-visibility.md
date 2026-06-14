---
'@loopdog/cli': patch
---

Surface the running Claude work cell at dispatch. The dispatch marker comment now
shows a `🔭 live session:` link, and `loopdog controller event`/`sweep` output
appends the session per processed item. Setting `LOOPDOG_DEBUG` traces the routine
`/fire` round-trip (request + response, session id/URL) to stderr for diagnosis —
off by default, and the bearer token is never logged.
