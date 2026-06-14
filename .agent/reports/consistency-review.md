# Loopdog Task-Spec Consistency Review

> Adversarial cross-task contract-drift review over the 94 task specs (2026-06-08).
> Method: 13 per-contract auditors → per-finding adversarial verification (refute
> unless a real implementer-tripping conflict) → synthesis. 26 candidates → **22
> confirmed real**. Severities are the *verified* judgments.

## ✅ Resolution — all 22 applied (2026-06-08)

Every finding below was reconciled (one agent per file, against a shared
canonical-decisions spec; verified by re-grep — no flagged drift remains). The
design calls, taken with a simple-architecture / keep-the-adopter's-repo-clean
lens:

- **Run-record store (H1, N1):** canonical store is the orphan **`loopdog/telemetry`**
  branch (append-only day-bucketed NDJSON, 0053-owned); `.loopdog/runs/` removed —
  loop runs never touch the adopter's working branch/PRs.
- **Mode promotion (H12):** one guarded command **`loopdog promote <loop> --to`**;
  `loopdog loops set … mode=` removed (kept for non-mode fields).
- **Adapter selection (H2, M2):** scalar **`adapter: <name>`** (default `auto`);
  `id`/`kind` dropped — matches the port's `name` field.
- **Adapter port (B1, H3–H5):** `0024`'s per-phase surface is canonical
  (`name`, `detect(repo: RepoFs)`, object `capabilities()`, methods → `CommandResult`).
- **Config (H8, H9, M1):** root default at `backends.default`; `0050`'s
  `budgets:` + `kill_switch:` shape adopted in `0006`/`0059`; `on_budget_exhausted`
  dropped.
- Plus: `trigger_modes` += `self_hosted_dispatch` (H6); `loopdog:needs-human` flat
  label (H7); trailing-parens criteria rows + single `loopdog:plan` attribute tag
  (H10, M4); `brief_ref = <loop>/prompt.md@<sha8>` (M3); `prompts show` (H11);
  `resume-all` for global clear (M6); `resilience.max_fix_attempts` (H13); pre-flight
  gate order aligned (M5).

The findings below are retained for the audit trail; all are now **resolved**.

---

**Verdict (at review time):** The spec set was **not yet internally consistent
enough to build from as-is** — one BLOCKER (the `ProjectAdapter` port is forked into two incompatible
interfaces) plus a cluster of HIGH conflicts where canonical owners and their
consumers define the same contract differently. None are mere omissions; in each
case two specs *affirmatively* define a shared contract differently, so code
written from one won't link against the other. Every conflict has a clear
canonical owner and a small, mechanical fix, and they cluster around four
contracts (the adapter port, `loopdog.yml` config keys, the run-record store, and
CLI verbs), so reconciliation is bounded.

---

## BLOCKER

### B1 · `ProjectAdapter` port — entire method surface is forked
**Files:** `0024`, `0027`, `0026`, `0028`. Canonical `0024` defines five async
runner methods that *execute and return a result* (`build/test/lint/run/deploy(ctx):
Promise<CommandResult>` + `detect/capabilities/describe`); `0027` defines a
structurally different single *descriptor* method `command(cap, ctx): Command|null`
that "never shells out," with no per-phase methods. `0026`/`0028` (conformance kit)
code against `0024`. An adapter with only `command()` can't satisfy the interface
the runtime + kit use.
**Fix:** `0024` is the port owner — conform `0027` to it (per-phase methods, drop
`command()`/`id`/`Capability[]`/`RepoFs`). This also clears H2/H4/H5.

---

## HIGH

### H1 · Run-record store — two "canonical" stores *(design decision)*
**Files:** `0094`, `0053`. `0094` (store owner) → files at `.loopdog/runs/<run_id>`
on the working branch; `0053` declares its own canonical store: orphan branch
`loopdog/telemetry` with `runs/YYYY-MM-DD.ndjson`. Downstream readers (`0069`,
`0050`) target `0053`'s. A record written per `0094` is invisible to a reader per
`0053`. **Fix (decide):** either `0094` blesses `0053`'s `loopdog/telemetry` NDJSON
layout, **or** `0053` layers its index over `0094`'s `.loopdog/runs/` — pick one.

### H2 · Adapter identity field — `name` (0024) vs `id` (0027). Fix: `0027`→`name`. *(subsumed by B1)*
### H3 · `detect()` input — `workdir: string` (0024) vs injected `RepoFs` (0025/0027/0028, 3-agree). Fix: change **`0024`** to `detect(repo: RepoFs)` + declare `RepoFs` in `@loopdog/core` (the one HIGH where the owner moves).
### H4 · Result type — `CommandResult` (0024) vs `AdapterCommandResult` tri-state (0026). Fix: `0026`→`CommandResult`. *(subsumed by B1)*
### H5 · `capabilities()` — object-of-booleans (0024) vs `Capability[]` (0027). Fix: `0027`→object. *(subsumed by B1)*
### H6 · Backend `trigger_modes` enum missing `self_hosted_dispatch` — `0074` asserts a 4th value not in `0019`'s closed enum. Fix: add `self_hosted_dispatch` to the enum in `0019` + `0060`.
### H7 · Off-ramp label — `0038` writes `loopdog:state/needs-human`; canonical `0011` (and 11 other refs) use `loopdog:needs-human`. Fix: `0038`→`loopdog:needs-human`.
### H8 · Root default backend — `0023` uses top-level `backend:` scalar; `0006`/`0010`/`0059` use `backends.default`. Onboarding's default would be silently ignored. Fix: `0023`→`backends.default` (stage overrides as sibling keys).
### H9 · Budget config — `0006`/`0059` say `budget: {monthly_usd, quota}`; `0050` (impl owner, with zod schema) says `budgets: {window, global, per_loop, on_exceeded}` + top-level `kill_switch:`. Fix: back-port `0050`'s richer shape into `0006`/`0059`.
### H10 · Acceptance-criteria row syntax — `0014`/`0033` use trailing `(test: …)`/`(manual)`; `0039` uses leading `test:`/`manual:` prefix. The single parser can't read both. Fix: `0039`→trailing-parens form.
### H11 · `loopdog prompts` print verb — `show` (0072, CLI owner) vs `render` (0022). Fix: `0022`→`show`.
### H12 · Mode-promotion command — `loopdog promote <loop> --to` (0009, carries the `tier:core` auto-act guard) vs `loopdog loops set <loop> mode=` (0071, walkthrough). The `loops set` path bypasses the guard. *(design decision)* **Fix (decide):** make `promote` canonical and `loops set mode=` an alias delegating to it (guard included), or drop `loops set mode=`; update `creating-a-loop.md`.
### H13 · Fix-loop ceiling — `max_fix_attempts: 2` (0091, owner) vs `fix.max_cycles: 3` (0044). Fix: `0044`→`resilience.max_fix_attempts`, default 2.

---

## MEDIUM

### M1 · Budget-exhausted action — three keys: `budgets.on_exceeded` (0050), `quota.on_exceeded` (0075), `resilience.on_budget_exhausted` (0091, dead/ignored). Fix: drop `0091`'s key; reference `budgets/quota.on_exceeded`.
### M2 · Adapter selector key — `adapter.kind` (0026) vs `adapter.id` (0025/0027). Fix: standardize on `adapter.id`; pin it in `0006`.
### M3 · `brief_ref` format — `.loopdog/loops/…@v7` (0012) vs `<loop>/prompt.md@<sha8>` (0022, owner). Fix: `0012`/`0069`/`0072`→`@<sha8>`.
### M4 · `<!-- loopdog:plan -->` marker — attribute tag (0016, owner) vs open/close pair (0039). Fix: `0039`→`0016`'s self-closing attribute form.
### M5 · Pre-flight gate ORDER — `0036` narrates `authz → budget → resilience`, inverting `0090`'s `kill-switch/budget → circuit-breaker → authz → DoR/DoD`. (`0012` uses an unordered set; only `0036`'s narration conflicts.) Fix: reorder `0036`'s narrated chain to match `0090`.
### M6 · `loopdog resume` overloaded — global kill-switch clear (0050) vs per-loop un-pause (0071). Fix: `0050`→`loopdog resume-all` for the global clear.

---

## NIT

### N1 · Run-record on-disk layout — `0094` example `<run_id>.*` vs `0015` (layout owner) `<run_id>/record.yml`. `0094` hedges "e.g." and defers to M04, so non-binding. Fix: align `0094`'s example to `0015`'s per-run directory.

---

**Reconciliation guidance:** Fixing **B1** (conform `0027` to `0024`) auto-clears
H2/H4/H5, leaving **H3** as the one adapter edit where `0024` itself moves. The
config-key conflicts (**H8, H9, M1, M2**) all converge on `@loopdog/config` / `0006`
— resolve them together to keep that schema coherent. Three findings need a design
call: **H1** (run-record store), **H12** (mode-promotion command), and the H9
direction. Group remaining edits **by file** (0024, 0027, 0006, 0012, 0050 are each
touched by several findings) so each file is reconciled once, coherently.
