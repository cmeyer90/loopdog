# Security Review (pre-1.0.0)

A documented review of Loopdog's three highest-risk surfaces — **GitHub
permissions/identity**, **secret handling across the two planes**, and the
**prompt/trigger injection surface** — before `1.0.0`. Each finding is
dispositioned: fixed (with evidence), accepted-risk (with rationale), or deferred
(with a follow-up). Companion: [Security & Trust Model](security.md) (the
adopter-facing guarantees), [Trust Boundary](trust-boundary.md) (credential
residency).

> **Scope note.** This is an internal/self review against the threat model. An
> *independent* third-party review remains an operator step before a public
> 1.0.0; this document is its agenda + the resolved-in-code baseline.

## Surface 1 — GitHub permissions & identity

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1.1 | Reusable workflows must be least-privilege | high | **Fixed** — `reusable-events.yml` / `reusable-sweep.yml` declare explicit `permissions:` (contents/issues/pull-requests write, checks read; nothing else). `loopdog-ci.yml` is `contents: read`, no secrets. |
| 1.2 | Loopdog must not write the checks that gate it | high | **Fixed** — the gating CI/branch-protection/workflow files are outside the writable blast radius (`forbidden_paths`), and `tier:core` merge stays human-gated. |
| 1.3 | No ambient Loopdog GitHub App / org-wide token | high | **Accepted-by-design** — there is no Loopdog App; the controller uses the repo's own `GITHUB_TOKEN`. Optional PAT is adopter-scoped. |

## Surface 2 — Secret handling (two planes)

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 2.1 | A secret must never reach model-visible/persisted output | critical | **Fixed + tested** — the scrubber (`scrubSecrets`, M07) redacts known secret shapes from briefs/comments/plans/run-records; `packages/backends/test/secrets.test.ts` injects sentinels and asserts zero leakage; the lint rule rejects secret literals in prompts without echoing them (`compose.test.ts`). |
| 2.2 | `sensitive` project secrets must be stripped before the agent phase | high | **Fixed** — the work-cell secret-phase model (Codex `setup-only`) strips `sensitive` env before the agent runs; `secrets.ts` + its tests cover the phases. |
| 2.3 | No model API key on the primary path | high | **Accepted-by-design** — subscription-driven; the only key-holder is the opt-in self-hosted backend (`LOOPDOG_MODEL_API_KEY`). |

## Surface 3 — Prompt / trigger injection

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 3.1 | An untrusted trigger must not dispatch before approval | high | **Fixed + tested** — the authorization gate parks an untrusted trigger (`loopdog:needs-approval`) with zero dispatch, and an untrusted self-approval does not release it (`packages/runtime/test/authorization-e2e.test.ts`). |
| 3.2 | Untrusted issue/comment bodies must be data, not instructions | high | **Fixed + tested** — the brief composer places item/discussion content below an explicit data/instructions boundary with an untrusted-input preamble (prompt-injection defense); regression test in `packages/backends/test/compose.test.ts` ("treats untrusted … content as data"). |
| 3.3 | A scope-exceeding agent change must halt | medium | **Fixed** — blast-radius (`max_files`/`max_diff`) halts + escalates an over-scope PR (M09 · 0038; `loops-e2e.test.ts`). |
| 3.4 | Quota drain by trigger spam | medium | **Fixed** — per-actor + global rate caps (M17) + budget/quota gates (M12) bound spend; a burst parks/defers, never overruns. |

## Residual risks (accepted)

- A **trusted-collaborator account compromise** bypasses the authorization gate
  (it trusts the association GitHub reports). Mitigation: human-gated merge +
  blast radius + budgets still bound the damage.
- A **promoted `act` loop steered by injection within its blast radius** can make
  bounded changes until review catches them. Mitigation: cross-provider review,
  DoD gate, human-gated `tier:core`.
- **Provider-cloud visibility** of dispatched code/brief is inherent to the
  provider you chose; ZDR + self-hosted are the escape hatches (see
  [trust-boundary.md](trust-boundary.md)).
- **ToS of subscription automation** is unresolved (task 0092) — an adopter
  decision, not a code finding.

## Verdict

No unresolved **critical/high** finding in the reviewed surfaces — each is fixed
(with a cited test) or accepted-by-design. The independent third-party review is
the remaining gate before a public 1.0.0.
