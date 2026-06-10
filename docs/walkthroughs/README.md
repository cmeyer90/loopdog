# Walkthroughs

Concrete, end-to-end examples of using looper, distilled from the expected user
flows. They are illustrative (the product is pre-V1) but track the design in
[`../architecture.md`](../architecture.md) and the roadmap in
[`../../.agent/milestones.md`](../../.agent/milestones.md).

Running character: **Dana**, who maintains `acme/widgets` (a TypeScript API) and
has a **Claude Max** subscription.

| Flow | What it shows |
|---|---|
| [Connecting accounts](connecting-accounts.md) | `looper login` — keyless GitHub + Claude subscription connect |
| [A ticket's lifecycle](ticket-lifecycle.md) | One issue from filed → groomed → implemented → reviewed → merged → deployed, on a subscription |
| [Creating a loop](creating-a-loop.md) | `looper loops new` questionnaire → per-loop file → validate → dry-run → promote; plus the fast-path variant |

## The one-paragraph model

Labels on GitHub issues/PRs are the state machine. Looper's **controller**
(running in the adopter's GitHub Actions or via the CLI, deterministic, *no model
calls*) watches that state on **GitHub events + a cron reconcile sweep**, and for
each item it **claims** it, **composes a brief**, **dispatches** the work to a
**provider cloud agent on the user's subscription** (Claude/Codex), **ingests** the
PR that agent opens, and **gates** it (the adopter's CI + cross-model review +
deploy smoke) before merge. Every body of work also gets a **durable plan** written
into the repo. The engineer's job is tuning the loops via the **CLI**, not
prompting agents.
