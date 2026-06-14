# 0092 — ToS & Subscription-Automation Findings (2026-06-09)

Research deliverable for task
[`0092-tos-and-subscription-automation-spike`](../tasks/0092-tos-and-subscription-automation-spike.md).
Question: **may a third-party tool programmatically drive a user's paid Claude /
Codex subscription quota, unattended, at scale?** All sources accessed
2026-06-09 (web). OpenAI legal pages block direct fetch (HTTP 403); their text
below is reconstructed from search-index snippets and flagged accordingly.

## Verdict summary

| Provider | Verdict | Basis |
|---|---|---|
| **Anthropic (Claude routines `/fire`)** | **Permitted** — explicitly, for this exact pattern | Routine API trigger is documented *for external programmatic callers*; ToS automation ban has an express carve-out |
| **OpenAI (Codex cloud via `@codex`)** | **Gray area — silence** (leaning tolerated within metering, acting as the adopter's own identity) | No clause prohibits it; metering is the de facto control; official guidance steers automation to API keys |
| **Both** | Adopter-runs-own-instance is defensible; **hosted multi-tenant on others' credentials is prohibited** | Account-sharing bans at both providers |

## Anthropic findings

1. **Consumer ToS** (anthropic.com/legal/consumer-terms, eff. 2025-10-08) bans
   automated access "**except** when you are accessing our Services via an
   Anthropic API Key **or where we otherwise explicitly permit it**". Account
   sharing is prohibited; "bypassing any of our systems or protective measures"
   is prohibited.
2. **The routines `/fire` trigger is that explicit permission.** Official docs
   (code.claude.com/docs/en/routines; platform.claude.com/docs/en/api/claude-code/routines-fire):
   "trigger on demand by sending an HTTP POST to a per-routine endpoint with a
   bearer token… wire Claude Code into alerting systems, deploy pipelines,
   internal tools"; "Typical callers are alerting systems, **CI pipelines**, and
   internal tools that need to start a Claude Code session programmatically."
   The docs ship a GitHub Actions example. Auth is a per-routine bearer token
   (`sk-ant-oat01-…`, shown once, scoped to one routine, no account read
   access); requires Pro/Max/Team/Enterprise; beta header
   `anthropic-beta: experimental-cc-routine-2026-04-01`; "research preview…
   may change."
3. **Caps, not human-only rules, bound "at scale":** routines draw down
   subscription usage; a per-account **daily run cap** applies; hourly caps on
   GitHub-event triggers; past the caps, orgs with usage credits run on metered
   overage, others get rejections until the window resets.
4. **The Feb 2026 crackdown is about a different surface.** Anthropic's
   compliance page: "Anthropic does not permit third-party developers to offer
   Claude.ai login or to route requests through Free, Pro, or Max plan
   credentials on behalf of their users" (enforced against OpenCode/OpenClaw-class
   harnesses reusing **login OAuth tokens for raw inference**). The per-routine
   `/fire` token is a purpose-built credential whose docs instruct embedding it
   in external systems — a different, sanctioned surface. Loopdog must never
   touch claude.ai login OAuth tokens.
5. **New sanctioned path (eff. 2026-06-15):** subscription plans receive a
   monthly **Agent SDK credit** that explicitly covers "third-party apps that
   authenticate with your Claude subscription through the Agent SDK" — a
   material softening; relevant as a future alternative backend, not V1's path.

## OpenAI findings

1. **Terms of Use** (openai.com/policies/row-terms-of-use, via snippets — direct
   fetch 403): bans "Automatically or programmatically extract data or Output",
   "circumvent any rate limits or restrictions", account sharing. **Nothing
   addresses third-party tools triggering subscription features as the account
   holder.**
2. **Codex docs are silent on who may post `@codex`.** developers.openai.com/codex/cloud
   and /codex/integrations/github document the mention trigger with zero
   statements about which users/roles/bots may invoke it. Mechanically the
   mention resolves through the **commenter's GitHub↔ChatGPT account link** —
   so a bot identity with no linked ChatGPT account likely cannot trigger Codex
   at all (inference; spike 0093 RUNBOOK §2 tests it).
3. **OpenAI steers automation to API keys but documents the alternative:**
   "We recommend API key authentication for programmatic Codex CLI workflows"
   and "The right way to authenticate automation is with an API key. Use this
   guide only if you specifically need to run the workflow as your Codex
   account" (developers.openai.com/codex/auth/ci-cd-auth — an official guide
   for exactly that, with warnings: trusted runners only, no public repos, no
   shared auth files).
4. **OpenAI's own features normalize unattended subscription consumption:**
   `codex cloud exec` for scripts/CI, the Slack `@Codex` integration, scheduled
   Automations ("run unattended"), and automatic PR reviews — all on plan quota.

## Precedents

- **Negative (Anthropic):** OpenCode/OpenClaw-class tools using account login
  OAuth tokens → legal requests, token blocking, explicit ban (Jan–Apr 2026).
  Targeted credential-reuse-for-inference, not documented trigger endpoints.
- **Positive (Anthropic):** official `claude-code-action` documents
  `CLAUDE_CODE_OAUTH_TOKEN` (Pro/Max via `claude setup-token`) for CI; `/fire`
  docs include an Actions example; Agent SDK credit covers third-party apps.
- **OpenAI:** no known enforcement against user-consented mention automation;
  no written sanction either.

## Consequence model (if the answer were/becomes "no")

Trigger conditions: a provider prohibits third-party subscription orchestration
in writing, blocks loopdog's pattern technically, or the `/fire` research preview
is withdrawn without replacement.

1. **Product re-centering:** the self-hosted/API backend (0074) becomes the
   *primary* path; the architecture already keeps it first-class. Loops, state
   machine, plans, adapters, gates are unchanged — only dispatch changes.
2. **M02 changes:** onboarding (0010) defaults to API-key/self-hosted connect;
   subscription connect becomes the optional path (or is removed for the
   affected provider). `loopdog.yml` `backend:` default flips.
3. **M05 changes:** the affected subscription backend (0020/0021) is demoted to
   experimental/off; 0074 hardening is pulled earlier in the order.
4. **M07 changes:** the project-secret plane simplifies — secrets inject into
   the adopter's own runner (0031), the provider-cloud residency docs (0030/0032)
   shrink to the surviving provider.
5. **Docs/walkthroughs:** connecting-accounts walkthrough and quickstart rewrite
   around `ANTHROPIC_API_KEY`/OpenAI-key self-hosted execution.
6. **Per-provider asymmetry is survivable:** a Codex "no" with a Claude "yes"
   leaves loopdog subscription-native on Claude and self-hosted/API for
   cross-provider review (the `codex exec` API-key path), and vice versa.

## Go/no-go recommendation

**Conditional GO for the subscription-primary thesis.**

- **Claude: GO.** The `/fire` pattern is documented for external programmatic
  callers; treat the research-preview status as an availability risk (pin the
  beta header, handle drift via the gated live-smoke, M18 · 0087), not a
  permission risk. Hard rules encoded into design: one account = one adopter;
  never handle claude.ai login OAuth tokens; back off on 429/`Retry-After`;
  never rotate accounts; model the daily caps in budgeting (M12 · 0075).
- **Codex: CONDITIONAL GO.** Ship as "**acts as you, on your repos, within your
  limits**": mentions posted under the adopter's own attributable identity,
  conservative rate caps (M12 · 0075), circuit-breaker on limit signals
  (M19 · 0090). Before marketing unattended at-scale operation, obtain a written
  staff answer (channel: openai/codex GitHub repo / developer forum).
- **Both:** loopdog is distributed as a tool the adopter runs on their own
  account. No hosted multi-tenant mode in V1 (would cross explicit prohibitions
  at both providers). State the ToS posture plainly in the trust docs (0032,
  0062).

## Operator follow-up (outreach for written confirmation)

Not performable by an autonomous agent (outward-facing communication); channels
identified:

- **Anthropic:** contact-sales (named by the compliance page for auth-method
  questions); support.claude.com; usersafety@anthropic.com (usage-policy
  questions); Claude Developers Discord.
- **OpenAI:** openai/codex GitHub issues/discussions (staff-answered);
  community.openai.com Codex category; help.openai.com support form;
  contact-sales for Business/Enterprise framing.

Suggested written question (both providers): "We build an open-source tool an
individual subscriber installs in their own GitHub repo. With the subscriber's
consent it triggers their own subscription cloud-agent features
(Claude routine API trigger / `@codex` mentions posted as the subscriber) from
their repo's CI, within published rate limits, one account per user, no
credential sharing. Is this permitted use of a personal subscription?"
