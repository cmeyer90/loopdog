# Walkthrough: Connecting accounts (`looper login`)

The design goal is **keyless** (Milestone 02 · 0077, Milestone 07 · 0029): Dana
never creates a PAT or pastes an API key. There are two distinct identities, and
neither needs a looper-hosted GitHub App:

1. **Looper's repo identity** — how the controller reads/writes the repo. In CI
   this is just the Actions **`GITHUB_TOKEN`** (free, zero-setup). Nothing to
   connect.
2. **Dana's local CLI + provider connections** — `looper login` authenticates the
   local GitHub CLI identity; `looper connect` records provider-specific access.
   Claude uses manual routine import, not a model API key.

## `looper login`

```
$ looper login
Welcome to looper. Let's connect your accounts — no API keys needed.

[1/2] GitHub (for the local CLI)
  → Open https://github.com/login/device and enter code:  WXYZ-1234
    (waiting for authorization in your browser…)
  ✓ Signed in as @dana
    (device-flow OAuth — no PAT created; or looper reuses your existing `gh` auth)

[2/2] Model provider — your subscription
  ? Connect which provider(s)?   ❯ Claude   ·   Codex   ·   Claude + Codex
  Claude →
    → Open Claude Routines and create/edit the loop routine
    → Select acme/widgets and the Claude cloud environment
    → Add an API trigger, then paste the /fire URL and one-time token
  ✓ Imported Claude routine fire URL + token as Actions secret refs
  ✓ Recorded repo/environment setup assertion for acme/widgets

✓ All set. Tokens stored in your macOS Keychain (no keys to manage).
  In CI, looper's controller uses GITHUB_TOKEN + the imported routine secret refs.
  Check anytime:  looper auth status
```

## What each half does

- **GitHub (local CLI)** uses the OAuth **device flow** (like `gh auth login`) to
  authenticate *Dana* for setup/control commands (`looper init`, applying config,
  approving parked items). It needs only a public OAuth-App **client_id** — GitHub
  hosts the flow, so there's **no private key and no server to run**. (Or looper
  just reuses Dana's existing `gh`/git auth and skips this entirely.)
- **The controller in CI** doesn't log in at all — it runs in Actions under the
  workflow's **`GITHUB_TOKEN`**, which is auto-provisioned and scoped to the repo.
- **Claude** uses **manual routine import** — *not* an API key and not the Claude
  Code GitHub Action. Dana creates or edits a routine in Claude's web UI, selects
  the repo and Claude cloud environment, adds an API trigger, and gives looper the
  generated `/fire` URL plus one-time bearer token. Looper stores only secret refs
  and later calls `/fire` from Actions on Dana's subscription.
- **Claude project env vars** are configured in the Claude cloud environment, not
  passed from GitHub Actions when looper calls `/fire`.

## Verify — `looper auth status`

```
$ looper auth status
GitHub
  local CLI:   @dana (device-flow OAuth / gh)                     ✓
  CI identity: GITHUB_TOKEN (in Actions) — no looper App needed   ✓
Provider
  claude:      routine import · fire URL/token refs present       ✓
  codex:       not connected
Secrets
  model API key:  none — subscription auth                        ✓
Stored in:  macOS Keychain (service: looper)
```

`model API key: none` is the point: on the subscription path there is no
long-lived key anywhere.

## How loops still hand off without a looper App

Because looper's controller acts as `GITHUB_TOKEN`, a label it writes won't fire
the *next* loop's event (GitHub's loop-prevention). That's fine — the **cron
reconcile sweep** picks the item up on its next tick. Events from *humans* and from
the *provider's* agent (opening a PR) still fire instantly; only
controller→controller handoffs run at sweep pace. An adopter who wants those
instant too can drop a fine-grained **PAT** into a repo secret. A full looper
GitHub App (a distinct `looper[bot]` identity, org-wide install) is a deliberately
**post-V1** option, never required.

## Notes

- **Revoke:** `looper logout` clears local GitHub auth; rotate/revoke the Claude
  routine API token in Claude's routine settings and re-run
  `looper connect claude --reimport` to update the secret refs.
- **Zero-Data-Retention orgs** can't use Claude's cloud agents — those adopters
  connect the **self-hosted backend** instead (where the one API key lives in the
  adopter's own container).
- **Codex** is App-backed — authorize the Codex GitHub App on a ChatGPT
  subscription; dispatch is via `@codex` mentions rather than a routine API.
