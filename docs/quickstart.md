# Quickstart — attach Loopdog in ~10 minutes

From "I have a GitHub repo and a Claude or Codex subscription" to "Loopdog is
attached and groomed its first issue." Loopdog is **safe by default**: it observes
and explains until you promote a loop, runs the controller on Actions'
`GITHUB_TOKEN`, and drives work on your **subscription** — never a metered API key.

## The model in one paragraph

Loopdog is a controller that runs in your repo's GitHub Actions. **Labels are the
state machine** (`loopdog:state/*`), issues/PRs are the work items, and the loops
(triage · groom · implement · review · merge · deploy) are **data** — a
`loop.yml` + `prompt.md` per loop, executed by a generic runtime. The controller
itself never calls a model; it **dispatches** work cells to your Claude/Codex
subscription and **ingests** their PRs by correlation. No database, no queue, no
Loopdog GitHub App, no API key on the primary path.

## Prerequisites

- A GitHub repo you can add workflows + labels to.
- A **Claude** or **Codex** subscription (the kind you already use interactively).
- Node 20+ and the `loopdog` CLI (`npm i -g @loopdog/cli`, or `npx @loopdog/cli`).

## The seven steps

```bash
# 1. Import your subscription — opens the provider's normal sign-in; nothing is pasted.
loopdog login

# 2. Connect the repo — confirms the GitHub repo + identity (uses gh's token or a PAT).
loopdog connect

# 3. Attach — scaffold .loopdog/ (config + loops) and the workflow callers, SAFE by default.
loopdog init

# 4. Commit + push the attachment (the .loopdog/ folder + .github/workflows/loopdog-*.yml).
git add .loopdog .github/workflows && git commit -m "attach loopdog (dry-run)" && git push

# 5. Open a test issue (any feature request) and watch the groom loop comment a
#    plan-as-contract (acceptance criteria + scope) — in dry-run it only explains.
loopdog status            # fleet overview: every loop + its mode/tier, items waiting per stage, attention, throughput

# 6. Watch a specific item or loop as it runs.
loopdog run groom --issue <n> --dry-run     # preview what groom would do, now

# 7. Promote a loop to act once you trust it (start with groom; keep merge human-gated).
loopdog promote groom --to act
```

**Expected after step 5:** the groom loop posts a `<!-- loopdog:acceptance-criteria
-->` block + a scope marker on your test issue — the *plan-as-contract* the
implement loop will later satisfy. That's the "first groom" milestone the
[example attachment](examples.md) proves end-to-end offline.

## What's safe here

- **Dry-run by default.** Every loop starts comment-only; you promote per loop.
  `tier:core` merge loops stay human-gated even after promotion.
- **No keys on the primary path.** The controller uses `GITHUB_TOKEN`; work cells
  use your subscription (imported once). The only key-holding path is the opt-in
  [self-hosted backend](guides/providers.md).
- **Bounded blast radius.** `max_files`/`max_diff`, budgets + a kill switch, and an
  authorization gate cap what a run can touch — see [Security & Trust](security.md).

## Where next

- [Config reference](config-reference.md) — every `loopdog.yml` / `loop.yml` field.
- [Example attachment](examples.md) — a forkable repo Loopdog is attached to.
- [Authoring guides](guides/adapters.md) — add a project adapter or a model provider.
- [Security & Trust](security.md) — permissions, blast-radius guarantees, threat model.
- [Architecture](architecture.md) · [Codebase](codebase.md) — how it's built.
