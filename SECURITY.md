# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** via GitHub Security
Advisories ("Report a vulnerability" on the repository's Security tab). Do not
open public issues for security reports. You should receive an acknowledgement
within 7 days.

Until 1.0.0, only the latest release line receives security fixes.

## Scope notes for adopters

Looper orchestrates provider cloud agents against your repository. The
security-relevant boundaries are documented in
[`docs/architecture.md`](docs/architecture.md) ("Identity & secrets") and the
trust-boundary doc under `docs/`:

- Looper's controller authenticates as the GitHub Actions `GITHUB_TOKEN` of
  *your* repo; it stores no model API keys on the primary path.
- Project secrets used by work cells reside in the **provider's** cloud
  environment (Claude/Codex) on the primary path — review that residency before
  adopting.
- Never commit `/fire` URLs or bearer tokens; import them as GitHub Actions
  secrets. Looper refuses to serialize secret material into model-visible
  artifacts it controls.

## Maintainer credentials

- `NPM_TOKEN` (repo secret): npm automation token scoped to publish-only, used
  exclusively by the release workflow. Rotate on suspicion; publishing also
  carries npm provenance attestation so artifacts are verifiable.
- `ADMIN_TOKEN` (repo secret, optional): a maintainer PAT with repo
  `administration:write`, used only by the manually-dispatched
  branch-protection apply workflow. Not used by any loop or runtime path.
