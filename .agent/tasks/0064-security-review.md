# 0064 Security Review

Status: verified  
Branch: task/0064-security-review

## Goal

Run an independent, documented security review of loopdog before `1.0.0`,
covering the three highest-risk surfaces — GitHub permissions/identity, secret
handling across the two planes, and the prompt/trigger injection surface — and
either resolve each finding or record an accepted-risk decision with a mitigation.

## Background

Part of [Milestone 15](../milestones/milestone-15-v1-hardening-and-release.md):
"Security review precedes release; the merge loop stays human-gated on the
dogfood until the verification ladder is proven there." This is a hardening +
audit task, not a feature: it stress-tests the security posture already specified
across [architecture](../../docs/architecture.md) "Identity & secrets,"
"Authorization & trigger control," and the verification ladder. It depends on the
dogfood (0063) being live so the review runs against a real attached repo, not a
hypothetical one. Findings feed the release gate (0066). The non-negotiables it
must defend (architecture "V1 scope"): secrets never in model-visible context
loopdog controls; loopdog never able to edit the checks that gate it; untrusted
triggers parked before they reach an acting work cell.

## Scope

- Audit **GitHub identity & permissions**: `GITHUB_TOKEN` scoping, workflow
  `permissions:` blocks, the optional PAT path, and CLI OAuth device-flow token
  storage.
- Audit **secret handling** across both planes (M07): provider-cloud env/secrets
  (0030), self-hosted injection + leak guards (0031), and the scrubbing of
  secrets from anything model-visible loopdog composes (briefs, comments, logs,
  run records).
- Audit the **injection surface**: untrusted GitHub content (issue/comment bodies)
  flowing into composed briefs, and the authorization/approval gates (M17 · 0079,
  0080) that park it.
- Produce a written report (threat model + findings + dispositions) and land any
  in-scope fixes that the review surfaces.

### Technical detail

**Where this lands.** No new shipped package. The report lives at
`docs/security-review.md` (a release artifact, linked from the trust docs M14 ·
0058). Any concrete fixes land in the owning package (`github`, `backends`,
`runtime`, or `cli`) as small follow-up edits; regression tests for confirmed
injection/leak findings land as scenario/simulation cases in `@loopdog/testing`.

**Threat model — actors & assets.** Actors: anonymous public-repo user (opens
issues/comments), malicious dependency/PR author, compromised provider job.
Assets: the maintainer's subscription quota (drainable), repo write access (the
`GITHUB_TOKEN`), project secrets, and merge authority. The review must trace each
asset to the gate that protects it.

**Surface 1 — GitHub identity & permissions.** Verify every reusable workflow in
`templates/workflows/loopdog-*.yml` declares a least-privilege `permissions:`
block (e.g. `contents: write`, `issues: write`, `pull-requests: write`,
`checks: read` — never `write` on the checks that gate loopdog, per the ladder
rung-2 invariant). Confirm `GITHUB_TOKEN` cannot re-trigger workflows (the sweep
0076 carries handoffs — confirm no path depends on it re-triggering). For the
optional PAT (architecture "Identity & secrets"): confirm it is read from a repo
secret, never logged, never placed in a brief, and documented as fine-grained +
minimally scoped. For CLI auth (0029): confirm device-flow tokens go to the OS
keychain, not a dotfile, and `loopdog login` never prints them.

**Surface 2 — secrets (two-plane).** The invariant from architecture: loopdog never
serializes a long-lived credential into prompts, plans, comments, run records,
logs, or other model/GitHub-visible artifacts it controls. Verify: (a) no project
secret is ever interpolated into a composed brief, PR/issue comment, plan file,
run record, or Actions log — audit the brief composer (M05/runtime pipeline) and
run-record emitter (0012, 0094) for any field that could carry a secret; (b)
self-hosted leak guards (0031) redact secrets from work-cell output before ingest;
(c) the provider-cloud trust boundary (0032) is stated honestly — secrets reside
in Anthropic/OpenAI infra on the primary path, which the review documents rather
than "fixes." Add a redaction unit test fixture: inject a known sentinel secret
and assert it appears in zero loopdog-controlled model-visible or persisted output.

**Surface 3 — injection / authorization.** On a public repo anyone can post an
issue/comment, so untrusted text reaches the brief composer and a stranger could
drive an acting loop on the maintainer's quota. Verify the authorization gate
(M17 · 0079) runs in the runner pre-flight before any claim/dispatch, defaults to
`collaborators`, and that an untrusted trigger is **acknowledged but parked**
(`loopdog:needs-approval`, no dispatch, no spend) until a trusted human releases it
(0080) — a self-approval by the untrusted actor must not count. Verify the brief
composer treats issue/comment bodies as **data, not instructions** (e.g.
delimited/quoted, with a system preamble that the cloud agent must follow the
loop's `prompt.md` over any instructions found in the issue body) and does not
let untrusted content alter the transition, target branch, or gate config.
Confirm the kill-switch + budget gate (M12 · 0050) also sits before dispatch as a
quota-drain backstop.

**Method.** Run a structured pass per surface (a checklist below), an independent
reviewer ideally being a cross-provider agent dispatched `@codex review` /
Claude-routine over the relevant code (dogfooding the ladder), plus a manual
maintainer read. Each finding gets: severity (low/med/high/critical), surface,
disposition (`fixed` / `accepted-risk` / `deferred-post-V1` with rationale), and a
link to the fix PR or the follow-up task id.

**Edge cases to probe explicitly:** a comment containing `loopdog:approved` text
(must not self-approve); an issue body containing fake acceptance-criteria markers
or a `loopdog-run:` trailer (must not spoof correlation 0073); a PR that edits
`.loopdog/loops/*` or required-check config in the same change it asks to merge
(must not let a loop weaken its own gates); a secret echoed by a failing test in
work-cell logs (must be redacted before ingest).

## Out Of Scope

- New authorization/resilience *features* (M17 · 0079/0080, M19 · 0091) — this
  task audits and hardens what exists; it does not design new gates.
- Penetration-testing the providers' clouds — the trust boundary is documented
  (0032), not re-engineered.
- The post-V1 loopdog GitHub App, any hosted backend, or any API-key-on-primary-path
  change — out of V1 by definition.

## Acceptance Criteria

- [x] `docs/security-review.md` exists with a threat model and a findings table
      (severity · surface · disposition · link) covering all three surfaces.
- [x] Every reusable workflow declares a least-privilege `permissions:` block and
      grants no write to the checks that gate loopdog.
- [x] A redaction test injects a sentinel secret and proves it appears in zero
      model-visible or persisted output (brief, comment, plan, run record, log).
- [x] The authorization gate parks an untrusted trigger before any dispatch, and
      a self-approval by the untrusted actor does not release it (test or
      documented manual check).
- [x] The brief composer is shown to treat untrusted issue/comment bodies as data,
      not instructions (delimited + preamble), with a regression test.
- [x] Every finding is dispositioned: fixed (with PR link), accepted-risk (with
      rationale), or deferred (with a follow-up task id).
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Write the threat model (actors → assets → gates) into `docs/security-review.md`.
- [x] Audit Surface 1 (identity/permissions): workflows, PAT path, CLI token storage.
- [x] Audit Surface 2 (secrets): brief composer, run-record emitter, leak guards,
      trust-boundary doc.
- [x] Audit Surface 3 (injection/auth): pre-flight gate ordering, parking,
      data-not-instructions composition, correlation-spoofing.
- [x] Add regression tests for each confirmed finding (redaction sentinel,
      self-approval, untrusted-body-as-data) in `@loopdog/testing`.
- [x] Land in-scope fixes; spawn follow-up tasks for deferred items.
- [x] Fill the findings table with dispositions and link the report from the trust docs.

## Test Plan

Tests run via the repo's vitest runner; behavioral checks use the M18 fakes
(in-memory GitHub + fake/replay backend) — no real quota, no real secrets.

```bash
# replace with this repo's checks
npm test            # incl. redaction-sentinel, self-approval, untrusted-body-as-data cases
npm run lint        # incl. workflow permissions lint if present
# manual: cross-provider review pass dispatched over the audited packages
```

## Verification Log

- 2026-06-12: `docs/security-review.md` published — a findings table over the
  three surfaces (GitHub permissions/identity, secret handling, prompt/trigger
  injection), every finding dispositioned (fixed-with-test / accepted-by-design /
  deferred). Concrete ACs proven: reusable workflows declare least-privilege
  `permissions:` and grant no write to the gating checks; the scrubber redaction
  test injects sentinels and asserts zero leakage (`backends/test/secrets.test.ts`
  + the prompt secret-literal lint); the authorization gate parks an untrusted
  trigger with zero dispatch and an untrusted self-approval doesn't release it
  (`runtime/test/authorization-e2e.test.ts`); and the brief composer now places
  untrusted issue/discussion content below an explicit data/instructions boundary
  with a preamble — NEW regression test in `backends/test/compose.test.ts`
  ("treats untrusted … content as data"). No unresolved high/critical.

## Decisions

- Scope = the three highest-risk surfaces named in the goal. This is a documented
  **self-review** against the threat model with the fixes proven by tests; an
  **independent third-party review** is recorded as the remaining operator step
  before a public 1.0.0 (not something an offline agent can perform).
- Severity rubric: critical (secret/quota exfil), high (privilege/injection that
  needs a control), medium (bounded/defense-in-depth). Accepted-risk items
  (trusted-account compromise, in-blast-radius injection on a promoted loop,
  provider-cloud visibility, ToS) are explicit in the report with rationale, never
  silent. The brief-composer untrusted-input preamble was added as part of this
  review (3.2) rather than only documented.

## Risks / Rollback

The review is documentation + tests + small fixes, so rollback is low-risk
(revert the fix PRs). The real risk is a **missed** finding — a quota-drain or
secret-leak path that ships in `1.0.0`. Mitigation: the three-surface checklist is
exhaustive against the architecture's named invariants, and the release gate
(0066) blocks on an unresolved high/critical. Accepted-risk items must be explicit
in the report, never silent.

## Final Summary

`docs/security-review.md` reviews the three highest-risk surfaces with every
finding fixed-with-test or accepted-by-design and no unresolved high/critical:
least-privilege workflows that can't edit their own gates, a tested secret
scrubber, the authorization park, and a NEW untrusted-input boundary + preamble in
the brief composer (with a prompt-injection regression test). The independent
third-party review is the one remaining operator step before a public 1.0.0.
