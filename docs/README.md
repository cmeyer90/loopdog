# Loopdog Documentation

Loopdog attaches to a GitHub repo and runs the software lifecycle — triage, groom,
implement, review, merge, deploy — as loops over your Claude/Codex **subscription**.
The controller lives in your Actions, labels are the state machine, and it's
**safe by default**.

> **New here? → [Quickstart](quickstart.md)** — attach Loopdog in ~10 minutes.

## Reference

- [Config Reference](config-reference.md) — every `loopdog.yml` / `loop.yml` field.
- [Resilience & Failure Policy](resilience.md) — retries, timeouts, ceiling,
  circuit breaker, quarantine.
- [Benchmarks](benchmarks.md) — per-loop/provider cost/latency/success (`loopdog bench`).
- [Upgrading](UPGRADING.md) — the config version contract + `loopdog upgrade`.

## Install & Release

- [Install](install.md) — install the CLI, attach a repo, pin the workflows.
- [Release Checklist](release-checklist.md) — the 1.0.0 ship gate.

## Guides

- [Write a project adapter](guides/adapters.md) — teach Loopdog a new stack.
- [Write a model provider / backend](guides/providers.md) — add a provider.

## Examples

- [Examples](examples.md) — `examples/node-todo`, a forkable repo Loopdog is
  attached to (validated + exercised offline in CI).

## Trust

- [Security & Trust Model](security.md) — permissions, blast-radius guarantees,
  threat model, the ToS question.
- [Trust Boundary & Secret Residency](trust-boundary.md) — where every credential
  lives and what each path can verify.
- [Security Review](security-review.md) — the pre-1.0.0 findings + dispositions.

## How it's built

- [Architecture](architecture.md) — design tenets + V1 scope.
- [Codebase](codebase.md) — package layout + testing strategy.
- [Walkthroughs](walkthroughs/) — worked lifecycle traces.

> A static docs-site generator + GitHub Pages deploy + automated link-check are
> intentionally deferred (CI tooling, lower priority for V1); these markdown docs
> are the source the site would publish.
