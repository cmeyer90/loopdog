# Milestone 00: Pre-Build Validation Spikes

Status: blocked (agent-completable scope done; live-subscription trials operator-pending)

> The gating step **before** any build. A four-lens plan review converged on this:
> loopdog's whole thesis rests on external bets — subscription ToS, the Claude
> `/fire` beta API, and dispatch→PR correlation reliability — that must be
> validated before committing to M01+. A negative result here *changes the
> product*, so these run first, cheap, and throwaway. The Claude bootstrap question
> is now resolved from public docs: V1 uses **manual routine/API-trigger import**
> (fire URL + bearer token), not automated routine/token creation.

## Objective

De-risk the two external unknowns that could invalidate loopdog's premise before
writing production code: (1) whether unattended third-party orchestration of a
user's paid **subscription** is permitted, and (2) whether the subscription
**dispatch + PR-correlation** primitives actually work headlessly.

## Guiding Decisions

- **Throwaway code only** — the goal is a go/no-go answer, not reusable implementation.
- A negative ToS answer **re-centers the product on the self-hosted/API backend**
  *before* M05 is built (today that backend is "never the happy path" — a ToS "no"
  would make it the only path).
- Nothing downstream is trustworthy until these return green; the tasks that depend
  on these (0020, 0073) already say "spike it early."
- **Claude implementation path is manual routine import.** Current Claude docs say
  API triggers are added to an existing routine from the web UI and that the CLI
  cannot create or revoke API tokens. Loopdog therefore does not attempt to create
  Claude routines or tokens programmatically in V1. `loopdog connect claude` guides
  the user to create a Claude routine, select the repo/environment, add an API
  trigger, and import the `/fire` URL + bearer token as GitHub Actions secrets.
  Loopdog then calls `/fire` from Actions using those secret refs. This still uses
  the user's Claude subscription; it is not the `ANTHROPIC_API_KEY` GitHub Action
  path.

## Planned Tasks

| ID | Status | Branch | Title | Primary Deliverable |
|---:|---|---|---|---|
| 0092 | verified | task/0092-tos-and-subscription-automation-spike | ToS & Subscription-Automation Validation | Explicit (ideally written) answer from Anthropic + OpenAI on unattended third-party subscription orchestration; a documented consequence model if "no". |
| 0093 | blocked | task/0093-dispatch-and-correlation-spike | Dispatch & Correlation Spike | On real subscriptions: import a Claude routine `/fire` URL + token, fire it from Actions → branch/PR; `@codex` round-trip → PR; measure correlation reliability; confirm provider-created PRs fire events. |

## Definition Of Done

- [x] A documented ToS answer for both providers + a stated fallback if negative.
      (`../reports/0092-tos-findings.md`: Anthropic permitted, OpenAI gray-area
      conditional go; consequence model written.)
- [x] A proven headless `/fire` using an imported routine fire URL/token (fired
      from Actions, branch/PR opened) **or** a documented blocker; same for
      `@codex` dispatch. (Blocker documented: live subscriptions + Claude web UI
      are operator-only; ready-to-run kit in `spikes/0093-dispatch-correlation/`.)
- [ ] Measured correlation reliability over N runs (**operator-pending**) — the
      decision it feeds is already made conservatively: 0073 mandates a
      **non-agent-dependent** correlation signal as the authoritative key.
- [x] A clear **go/no-go** recommendation on the subscription-primary thesis.
      (**Conditional GO** — Claude go; Codex "acts as you, within limits" +
      written-answer outreach as operator follow-up.)

## Verification Log

- 2026-06-10: Public Claude docs review resolved the bootstrap design question:
  V1 uses manual Claude routine/API-trigger import (`/fire` URL + bearer token as
  secret refs), while live 0093 validation still must prove headless `/fire`
  dispatch, repo access, branch/PR production, event firing, and correlation.
- 2026-06-09: 0092 verified — ToS research complete for both providers with
  sources, consequence model, and a conditional-GO recommendation
  (`../reports/0092-tos-findings.md`). Key adopted constraints: one account =
  one adopter; never touch claude.ai login OAuth tokens; Codex dispatch must be
  user-attributable; no hosted multi-tenant in V1.
- 2026-06-09: 0093 spike kit built (`spikes/0093-dispatch-correlation/`) and the
  correlation design decision locked (dual-signal, dispatch-time signal
  authoritative) so M05/0073 are not design-blocked on live measurements. Live
  trials remain operator-pending; implementation proceeds under the conditional
  GO with the self-hosted backend as the documented fallback.
