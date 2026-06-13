# Looper Documentation

Looper attaches to a GitHub repo and runs the software lifecycle — triage, groom,
implement, review, merge, deploy — as loops over your Claude/Codex **subscription**.
The controller lives in your Actions, labels are the state machine, and it's
**safe by default**.

> **New here? → [Quickstart](quickstart.md)** — attach Looper in ~10 minutes.

## Reference

- [Config Reference](config-reference.md) — every `looper.yml` / `loop.yml` field.
- [Resilience & Failure Policy](resilience.md) — retries, timeouts, ceiling,
  circuit breaker, quarantine.

## Guides

- [Write a project adapter](guides/adapters.md) — teach Looper a new stack.
- [Write a model provider / backend](guides/providers.md) — add a provider.

## Examples

- [Examples](examples.md) — `examples/node-todo`, a forkable repo Looper is
  attached to (validated + exercised offline in CI).

## Trust

- [Security & Trust Model](security.md) — permissions, blast-radius guarantees,
  threat model, the ToS question.
- [Trust Boundary & Secret Residency](trust-boundary.md) — where every credential
  lives and what each path can verify.

## How it's built

- [Architecture](architecture.md) — design tenets + V1 scope.
- [Codebase](codebase.md) — package layout + testing strategy.
- [Walkthroughs](walkthroughs/) — worked lifecycle traces.

> A static docs-site generator + GitHub Pages deploy + automated link-check are
> intentionally deferred (CI tooling, lower priority for V1); these markdown docs
> are the source the site would publish.
