# Project Adapters

> **Moved.** The canonical adapter how-to now lives at
> [docs/guides/adapters.md](guides/adapters.md) (consolidated in M14 · 0060).
> See also the companion [provider / execution-backend guide](guides/providers.md).

A project adapter teaches Loopdog how to build/test/lint/run/deploy a project type
(`node`, `python`, `generic`, or your own) by implementing the `ProjectAdapter`
port in `@loopdog/core`. Adapters describe *what* to run; the runtime owns *how*
(process execution) over an injected runner. Read the
[authoring guide →](guides/adapters.md).
