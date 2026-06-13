# Example: `node-todo` — a repo Looper is attached to

A tiny Node todo library with a **complete Looper attachment** you can fork. It's
the executable proof the [Quickstart](../../docs/quickstart.md) works: the
committed config validates against Looper's real schema, and a scenario test
drives the built-in loops over it on the in-memory fakes (offline, zero quota).

## What's here

| Path | What it is |
|---|---|
| `src/todo.js`, `test/todo.test.js` | the real app + its passing test suite (`node --test`) |
| `.looper/looper.yml` | the root attachment: mode, triggers, sweep, budgets, authorization, resilience |
| `.looper/loops/<name>/` | the built-in loops as data (`loop.yml` + `prompt.md`) — identical to `templates/loops/*` |
| `.github/workflows/looper-*.yml` | the event + sweep + deploy workflow callers (run on **`GITHUB_TOKEN`**) |

## Safe by default

This attachment ships **`mode: dry-run`** — Looper observes and explains
(comment-only), and changes nothing until you promote a loop with
`looper promote <loop> --to act`. There is **no API key or PAT anywhere** in this
folder: the controller runs on Actions' `GITHUB_TOKEN`, and the work cells run on
your **Claude/Codex subscription** (imported once with `looper login`), never a
metered API key on the primary path.

## Fork and attach

```bash
cp -r examples/node-todo my-project        # or copy just the .looper/ + .github/ into your repo
cd my-project
looper login            # import your Claude/Codex subscription (no key pasted)
looper connect          # confirm the GitHub repo + identity
# open a test issue, watch the groom loop post a plan-as-contract, then:
looper promote groom --to act
```

See [docs/examples.md](../../docs/examples.md) for the full concept→file map and
the worked issue→merge trace, and [docs/quickstart.md](../../docs/quickstart.md)
for the 10-minute attach.
