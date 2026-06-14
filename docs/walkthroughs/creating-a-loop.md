# Walkthrough: Creating a loop

Loops are **declarative data**, one file per loop, and authored by a short
**questionnaire** — because a trigger is only ever a GitHub event or cron
(Milestone 16 · 0078, Milestone 02). Two examples: a focused review loop, and a
"fast path" issue→PR loop.

## Example A — a Dependabot auto-review loop

Dana wants: **auto-review Dependabot PRs, merge the safe patch bumps.**

### 1. Questionnaire

```
$ loopdog loops new
? Loop name: dependabot-review
? Trigger:              ❯ GitHub event   ·   Cron (scheduled)
?   Which event:        ❯ pull_request
? Acts on (from → to):  in-review → verified
? Backend:              ❯ codex   ·   claude   ·   self-hosted
? Require CI before merge? (Y/n) Y
? Risk tier:            ❯ safe   ·   core
? Max files per change: 3

✓ Created .loopdog/loops/dependabot-review/
    loop.yml     ← trigger, transition, backend, gates
    prompt.md    ← edit this: tell the loop what to do      (mode: dry-run)
```

She picked **codex** as the reviewer — a different model than the Claude
implementer, the cross-model review win.

### 2. Edit `loop.yml` for the details the questionnaire didn't ask

```yaml
# .loopdog/loops/dependabot-review/loop.yml
name: dependabot-review
trigger:
  github_event: pull_request
  filter: { author: "dependabot[bot]" }   # ← hand-added
transition: { from: in-review, to: verified }
backend: codex
gates: { require_ci: true, tier: safe, only: patch }   # ← only: patch hand-added
blast_radius: { max_files: 3 }
mode: dry-run
```

### 3. Edit `prompt.md` (the brief)

```markdown
# dependabot-review
Review this Dependabot PR. Confirm it's a patch-level bump, the changelog shows
no breaking changes, and CI is green. If all hold, approve and label `verified`.
Otherwise comment what's missing and label `needs-human`.
```

### 4. Validate → dry-run → promote

```
$ loopdog loops validate dependabot-review
✓ schema ok · transition in-review → verified legal (M03) · backend codex connected

$ loopdog run dependabot-review --dry-run --pr 200
[dry-run] matches author=dependabot[bot] · patch bump ✓ · would label verified

$ loopdog promote dependabot-review --to act          # after watching a clean run
✓ dependabot-review: dry-run → act
```

## Example B — a "fast path" issue→PR loop

Dana also wants: **new issue → a Claude instance implements it → opens a PR**, in
one loop (collapsing groom+implement). Same mechanics; the questionnaire picks the
`issues` event, `new → in-review`, `claude` backend. Two hand-edits make it safe:

```yaml
# .loopdog/loops/auto-implement/loop.yml  (excerpt)
trigger: { github_event: issues, action: [opened] }
transition: { from: new, to: in-review }
backend: claude
gates: { require_dor: false, require_ci: true, tier: safe, draft_pr: true }
```

```markdown
# auto-implement (prompt.md)
1. Restate the acceptance criteria you infer as a checklist, posted as a comment
   (the contract). 2. If too vague/risky, label `needs-human` and STOP.
3. Otherwise implement, add a test per criterion, run tests, open a DRAFT PR.
```

`validate` **warns** about `require_dor: false` (it skips human-confirmed
grooming). The counterweights: the brief **self-grooms into a posted contract**,
opens a **draft** PR that can't merge without the review loop + CI, and is scoped
to `tier:safe`.

## The shape of it

> **`loopdog loops new` (answer ~6 questions) → it generates `.loopdog/loops/<name>/`
> and prints the path → edit `loop.yml` for fine detail + `prompt.md` for the brief
> → `validate` → `--dry-run` → commit → promote to `act`.**

No loopdog code, each loop self-contained, nothing dumped into a giant
`loopdog.yml`, and nothing acts until it's dry-run and the mode is flipped.

## The honest trade-off (fast path vs. trustworthy path)

The fast path (Example B) skips **human-confirmed grooming**, so its weak point is
that the agent may infer the *wrong* acceptance criteria. It's bounded by the
posted contract + draft PR + review gates + `tier:safe`, and is great for crisp
repos or "turn this issue into a starting-point PR." For higher-stakes work, keep
grooming as its own loop (`require_dor: true`) so a human confirms the criteria
before a line is written — same building blocks, one more gate.
