# Looper

> **Status: pre-1.0, under active development.** The subscription-orchestration
> premise is validated by docs review but still pending live provider
> verification (see [Milestone 00](.agent/milestones/milestone-00-pre-build-validation-spikes.md)).

Looper is a **generic, open-source orchestrator of autonomous SDLC loops that you
attach to any GitHub repository — driven by your _existing_ Claude Code and Codex
subscriptions.** Control loops watch a repo's issues and PRs and drive work
through the lifecycle (groom → implement → review → merge → deploy), writing
durable plans into the repo as they go.

- **Subscription-native.** Model work runs in the provider's cloud agent on your
  Claude/Codex subscription, dispatched through GitHub — no API keys on the
  primary path, no per-token billing.
- **Zero-infra.** Looper's thin, deterministic controller runs in your repo's
  own GitHub Actions (or from the CLI). Nothing looper-hosted.
- **GitHub is the substrate.** Issues, labels, PRs, and comments are the
  database, the message bus, and the state machine.
- **Safe by default.** New installs run dry-run/human-gated; autonomy is granted
  per risk tier as loops earn trust.

## Learn more

- [Architecture & vision](docs/architecture.md) — what looper is and why.
- [Codebase layout](docs/codebase.md) — the `@looper/*` package boundaries.
- [Walkthroughs](docs/walkthroughs/README.md) — connecting accounts, a ticket's
  lifecycle, creating a loop.
- [Roadmap](.agent/milestones.md) — the V1 milestones.

## Development

```bash
npm install        # install workspace dependencies (Node 20+)
npm run build      # typecheck + build all @looper/* packages
npm test           # vitest across all packages
npm run lint       # eslint + package-boundary check + prettier
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
