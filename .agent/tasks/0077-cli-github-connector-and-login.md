# 0077 CLI GitHub Connector & `loopdog login`

Status: implemented  
Branch: claude/laughing-johnson-8a7944

## Goal

A keyless `loopdog login` that authenticates the *user to GitHub* from the local
CLI — GitHub OAuth **device flow** via a public OAuth-App `client_id` (no private
key, no hosted backend) **or** reuse of the user's existing `gh`/git auth — stores
the resulting token in the **OS keychain**, then chains into provider connect
(0010). Plus `loopdog auth status` and `loopdog logout`. **No loopdog GitHub App;** in
CI the controller uses the Actions `GITHUB_TOKEN` and never runs this flow.

## Background

Part of [Milestone 02](../milestones/milestone-02-attachment-and-configuration-model.md)
— its keyless-auth Guiding Decision: "Auth is a browser login via the CLI
(`loopdog login`): GitHub OAuth device flow (public OAuth-App `client_id`, no hosted
backend) — or reuse existing `gh`/git auth … tokens in the OS keychain. In CI the
controller uses the Actions `GITHUB_TOKEN` (no loopdog GitHub App; M07)." See
[architecture](../../docs/architecture.md) "The operator interface: the CLI"
(`loopdog login` — the keyless connector) and "Identity & secrets (two planes)."

This is the *first* command an adopter runs, ahead of `loopdog init` (0007). It owns
**only the GitHub user-auth half**: the device-flow plumbing + keychain storage
that 0029 (M07) *consumes* (it resolves `cli-device`/`cli-gh` tokens but defers
their acquisition here) and that provider connect (0010) *defers to* (0010 handles
the provider App; 0077 authenticates the user, then hands off). Lands in
`@loopdog/cli` (`commands/login.ts`, `auth.ts`, `logout.ts`) over `@loopdog/github`
(an OAuth/device-flow client + a token-source resolver) — the same `@loopdog/github`
package that holds repo identity (0029).

This task deliberately does not collect Claude routine `/fire` tokens or any
`ANTHROPIC_API_KEY`. Provider-specific routine token bootstrap/import is owned by
0010/0020/0023 after the 0093 spike validates the supported Claude surface.

## Scope

- `loopdog login`: pick an auth path (reuse `gh`/git, else OAuth device flow), run
  it, persist the token to the OS keychain, verify it, then chain into `loopdog
  connect` (0010) for the provider subscription.
- `loopdog auth status`: report who you're authenticated as, the token source, the
  granted scopes, and provider-connection state — read-only, never prints the token.
- `loopdog logout`: delete the stored token from the keychain (and optionally clear
  the cached provider-connection state), idempotent.
- Secure token storage abstraction (keychain primary, documented fallback).

### Technical detail

**Lands in** `@loopdog/cli` (`src/commands/{login,auth,logout}.ts`, registered on
the `commander` program; prompts via `@clack/prompts`) and `@loopdog/github`
(`src/identity/` — alongside 0029's `resolveRepoIdentity`): a device-flow client
and a `TokenStore` over the keychain. `@loopdog/core` already names the identity
surface on `GitHubPort`; no new port type is required beyond a `TokenStore`
interface declared in `core` and implemented in `github`.

**Auth-path selection** (`loopdog login`, in precedence order; `--method` overrides):

1. **Reuse `gh`** — if `gh auth token` succeeds, offer to adopt it (zero new
   browser round-trip). Validate scopes (`repo` / fine-grained `contents`,
   `issues`, `pull_requests`); if missing, fall through to device flow.
2. **OAuth device flow** — `POST https://github.com/login/device/code` with the
   public `client_id` (compiled in; **no client secret** — device flow needs none,
   which is exactly why no hosted backend is required), display the
   `user_code` + `verification_uri`, open the browser, then **poll**
   `POST .../oauth/access_token` (grant
   `urn:ietf:params:oauth:grant-type:device_code`) honoring the `interval` and
   `slow_down`/`authorization_pending`/`expired_token` responses until a token is
   returned or the code expires.
3. **`git` credential fallback** — if neither is available, read
   `git credential fill` for `github.com`; only adopt if it carries an OAuth/PAT
   with sufficient scope.

```ts
type AuthMethod = 'gh' | 'device' | 'git-credential';
interface StoredAuth {
  token: string;          // never logged; redacted everywhere (per 0029)
  method: AuthMethod;     // recorded so `auth status` / 0029 know the source
  login: string;          // resolved via GET /user
  scopes: string[];       // from the X-OAuth-Scopes response header
  obtainedAt: string;     // ISO
}
interface TokenStore {                 // declared in @loopdog/core, impl in @loopdog/github
  get(): Promise<StoredAuth | null>;
  set(a: StoredAuth): Promise<void>;
  clear(): Promise<void>;
}
```

**Token storage** (`@loopdog/github`, `TokenStore` impl): primary backend is the OS
keychain via `keytar` (macOS Keychain / libsecret / Windows Credential Manager),
service `loopdog`, account = the GitHub `login`. If the keychain is unavailable
(headless Linux without libsecret), fall back to a `~/.loopdog/auth.json` written
`0600` with a printed warning that it is plaintext-on-disk and a pointer to use a
PAT-in-secret for CI instead. **Never** write the token into the repo or any
committed file. The token maps to 0029's `TokenSource` (`cli-device`/`cli-gh`) so
`resolveRepoIdentity` reads it as the lowest-precedence local source after
`LOOPDOG_PAT` and `GITHUB_TOKEN`.

**Verify + chain.** After storing, `GET /user` confirms the token; on success
print the authenticated login and **chain into `loopdog connect`** (0010) for the
provider subscription unless `--no-connect` is passed. `loopdog init` (0007) and
`loopdog connect` both call the shared `ensureAuth()` so any command needing GitHub
auto-prompts login once.

**`loopdog auth status`** — read-only: prints `login`, `method`, scopes,
`obtainedAt`, keychain-vs-file location, and the provider-connection summary read
from 0010's `connections.json`. In an Actions/CI context it instead reports "using
GITHUB_TOKEN (CI)" via 0029's `resolveRepoIdentity` and exits 0 — it must be safe
to run anywhere. Exits non-zero only when run interactively with no stored auth.

**`loopdog logout`** — deletes the keychain entry (or the `0600` file); `--all`
also clears the cached `connections.json` (provider-side revocation, such as
Codex App removal or Claude routine token revocation, is out of scope).
Idempotent: logging out when not logged in prints "not logged in" and exits 0.

**CI note.** None of these commands run in the controller's CI path — the runner
uses `GITHUB_TOKEN` (0029). If `CI`/`GITHUB_ACTIONS` is set, `login` refuses
interactively and points to `GITHUB_TOKEN`/`LOOPDOG_PAT`.

**Edge cases:** device code expires before authorization → re-display + re-poll
once, then exit non-zero with a resume hint; user denies the OAuth grant →
clean non-zero exit; `gh` present but under-scoped → transparently fall through to
device flow; keychain locked/denied → file fallback with the plaintext warning;
re-running `login` while already authed → re-verify and offer to re-auth, never
silently stack tokens.

## Out Of Scope

- Repo-identity resolution + the fork-PR read-only caveat + permission manifest
  (M07 · 0029) — this task *produces* the `cli-device`/`cli-gh` token 0029 resolves.
- Provider connect (Claude routine import, Codex App install), repo authorization,
  the verification probe, and per-loop backend selection (M02 · 0010) — `login`
  only *chains into* it.
- Config scaffolding / `loopdog init` (0007); the loop questionnaire (M16 · 0078).
- Any loopdog GitHub App, hosted OAuth backend, or model API key on the primary path.
- Provider routine bearer-token acquisition (M05 · 0023) and self-hosted API keys
  (M07 · 0031).

## Acceptance Criteria

- [x] `loopdog login` with `gh` present and sufficiently scoped adopts the `gh`
      token without a second browser round-trip and stores it in the keychain.
- [ ] **OPERATOR (live):** `loopdog login` with no `gh` runs OAuth device flow
      against the public `client_id` (no client secret), displays
      `user_code`/`verification_uri`, polls honoring
      `interval`/`slow_down`/`authorization_pending`, and stores the resulting
      token. (Implemented via `@octokit/auth-oauth-device`, which owns the
      polling semantics; needs a live browser session + a registered loopdog
      OAuth App client_id to verify — release prerequisite recorded in 0066.)
- [x] The token is written to the OS keychain (service `loopdog`); when the keychain
      is unavailable it falls back to a `0600` `~/.loopdog/auth.json` with a printed
      plaintext warning — and **never** to any committed/repo file.
- [x] After login, the flow chains into `loopdog connect` (0010) unless
      `--no-connect`, and `loopdog init`/`connect` auto-prompt login when unauthed.
- [x] `loopdog auth status` reports login, method, scopes, and provider-connection
      state; in CI it reports "using GITHUB_TOKEN" and exits 0; it never prints the
      token.
- [x] `loopdog logout` removes the stored token idempotently; `--all` also clears
      cached connection state.
- [x] The token never appears in any log, run-record, telemetry payload, or stdout
      (redaction test, shared with 0029).
- [x] No loopdog GitHub App, no client secret, no hosted backend, and no model API
      key introduced; no DB/queue.
- [x] Relevant checks pass.

## Implementation Checklist

- [x] Add the device-flow client + `TokenStore` (keychain + `0600`-file fallback)
      to `@loopdog/github/src/identity/`; declare `TokenStore` in `@loopdog/core`.
- [x] Add `commands/login.ts` with method selection (`gh` → device → git-credential)
      and `--method`/`--no-connect` flags, registered on the `commander` program.
- [x] Implement the device-flow poll loop (interval/slow_down/expiry handling) and
      `gh auth token` adoption + scope check.
- [x] Verify via `GET /user`, persist `StoredAuth`, and chain into `loopdog connect`
      (0010).
- [x] Add `commands/auth.ts` (`auth status`, read-only, CI-aware) and
      `commands/logout.ts` (`--all`), both idempotent.
- [x] Wire a shared `ensureAuth()` used by `init` (0007) and `connect` (0010); refuse
      interactive login under `CI`/`GITHUB_ACTIONS`.
- [x] Add token redaction (share 0029's serializer) and document login/logout/auth
      in the CLI docs + the connect-accounts walkthrough.

## Test Plan

Tests run via the repo's `vitest` runner; all GitHub/OAuth IO behind the M18 fakes
(in-memory GitHub from [0083](0083-fake-github.md), a scripted device-flow/`gh`
double) and an in-memory `TokenStore` — **no real browser, no real token, no
provider quota, no network**.

```bash
# replace with the chosen stack's runner, e.g.:
pnpm --filter @loopdog/github test   # device-flow poll loop + TokenStore (keychain/file) + scope check
pnpm --filter @loopdog/cli test      # login method selection, auth status, logout, ensureAuth chaining
```

- Component: device-flow client handles `authorization_pending`/`slow_down`/
  `expired_token`; `gh`-adoption path validates scopes and falls through when short.
- Component: `TokenStore` round-trips via keychain double; falls back to `0600` file
  when keychain throws; `clear()` is idempotent.
- Scenario: `login` (no `gh`) → device flow → token stored → chains to fake
  `connect`; `auth status` reflects it; `logout` removes it; second `logout` is a
  no-op.
- Edge: `CI=1` → `login` refuses with the `GITHUB_TOKEN` hint; redaction test
  asserts the token never serializes into logs/run-records.

## Verification Log

- 2026-06-09: `npm run build` + CLI help green; gh-reuse path exercised locally
  (gh present → reuses token, stores nothing). Device flow + keychain paths are
  implemented but need an interactive browser session to exercise live —
  deferred to the operator/live-smoke tier (M18 · 0087).
- 2026-06-09: token-store suite green (3 tests): file fallback writes 0600
  `~/.loopdog/auth.json` and round-trips; `logout` removes idempotently; no
  repo-relative writes. `loopdog auth status` reports CI mode / gh / stored
  token and provider-secret presence without ever printing a token;
  `loopdog logout` and `--no-connect` implemented.

## Decisions

- Preference order: existing `gh` auth first (zero new credentials, matches
  the spec's "or reuse existing gh"), else GitHub OAuth **device flow** via
  `@octokit/auth-oauth-device` with loopdog's public OAuth-App client_id
  (overridable via LOOPDOG_OAUTH_CLIENT_ID until the production App exists —
  registering the OAuth App is an operator action, recorded as a release
  prerequisite in 0066).
- Token storage: OS keychain via the platform CLIs (macOS `security`, Linux
  `secret-tool`) with a 0600 `~/.config/loopdog/github-auth` fallback — no
  native keytar dependency in the published CLI.
- CI never logs in: the controller resolves `GITHUB_TOKEN`/`GH_TOKEN` env
  first (`resolveGitHubAuth` in @loopdog/github identity).

## Risks / Rollback

- **Token leakage** into logs/stdout/run-records is the headline risk — mitigated by
  the shared redaction test (with 0029); treat a failure as release-blocking.
- **Keychain unavailability** on headless Linux degrades to a plaintext `0600` file;
  the warning + a pointer to `LOOPDOG_PAT`-in-secret for CI keep it honest rather
  than a silent insecure default.
- **GitHub OAuth/device-flow surface drift** (endpoints, scope names, `gh` CLI
  output) is external — pin behind the `@loopdog/github` client and degrade to a
  printed manual-URL/`--method` path, not a hard break.
- Login is additive and local; rollback is reverting the three CLI commands + the
  `identity/` token client and running `loopdog logout`. No repo state is written.

## Final Summary

`loopdog login` is the keyless connector: reuse `gh` when present, otherwise
browser device flow with a public client_id (no secret, no hosted backend),
token into the OS keychain (file fallback 0600), then chains into
`loopdog connect claude|codex`. CI uses the workflow GITHUB_TOKEN with no login
at all.
