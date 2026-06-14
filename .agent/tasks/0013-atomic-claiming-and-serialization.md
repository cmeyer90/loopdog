# 0013 Atomic Claiming & Serialization

Status: verified  
Branch: claude/laughing-johnson-8a7944

## Goal

Stop concurrent invocations (overlapping events, an event racing the sweep) from
double-picking the same item or letting two runs collide on the same files —
using GitHub itself as the lock, with leases so a crashed run self-heals.

## Background

Part of [Milestone 03](../milestones/milestone-03-github-state-machine-core.md);
the runner (0012) depends on it. There is no side datastore, so the lock must be a
GitHub primitive. See [architecture](../../docs/architecture.md) "Concurrency &
claiming."

## Scope

- Atomic claim of an item before any dispatch.
- A lease/TTL so an abandoned claim is reclaimable by the sweep.
- Per-area serialization so two runs don't edit the same files concurrently.
- Release on completion or failure.

### Technical detail

**Atomic claim via GitHub optimistic concurrency.** GitHub has no transactions, so
use a single atomic-enough operation as the compare-and-set. Approach: add a
unique claim label `loopdog:claimed-by/<run_id>` *and* assign the bot, then
**re-read** the item; if more than one claim marker is present (lost race), the
lower `run_id` wins and the loser releases and aborts. The assignment + single
claim label is the CAS; the re-read resolves the rare double-add.

**Lease/TTL.** The claim carries a timestamp (in the run record + a
`loopdog:lease/<iso8601>` marker). The cron sweep treats a claim older than the
lease (e.g. 30 min, configurable) as **expired** and may reclaim the item —
covering crashed/timed-out runs. Provider work that legitimately runs long renews
the lease on ingest progress.

**Per-area serialization.** A loop config may declare `serialize_by` (e.g. a path
glob or service). The runner takes an advisory lock label
`loopdog:lock/<area>` before claiming; if held by a live (non-expired) run, the
item is deferred to the next sweep rather than dispatched. This prevents two PRs
mutating the same area into a merge conflict.

**Release.** On terminal outcome the runner removes the claim/lease/lock markers;
the sweep removes expired ones.

## Out Of Scope

- The transition pipeline (0012); the state labels themselves (0011).

## Acceptance Criteria

- [x] Two concurrent invocations targeting the same item result in exactly one
      claim; the loser aborts cleanly (race test in `packages/github/test/claims.test.ts`
      + the runner-level event-vs-sweep race test).
- [x] An expired-lease claim is reclaimable by the sweep (crash-recovery test:
      `clearExpiredClaim` + re-acquire proven).
- [x] `serialize_by` defers a second item in the same area instead of dispatching
      it concurrently (area-lock test; different area not blocked).
- [x] Claims/leases/locks are released on completion and on failure (release
      test + the runner's failure path releases before attempt-bump).

## Implementation Checklist

- [x] Implement the label-based claim + re-read race resolution (pure protocol
      in `core/transitions/claim-protocol.ts`; IO in `github/claims/claims.ts`).
- [x] Implement lease stamping, expiry, and renewal-on-progress (`renewLease`).
- [x] Implement `serialize_by` advisory area locks (lock label on the working
      item; "held" = any other live-leased item carries `loopdog:lock/<area>`).
- [x] Implement release on terminal outcome (`releaseClaim`) + sweep cleanup of
      expired markers (`clearExpiredClaim`).

## Test Plan

```bash
# replace with the chosen stack's runner
# simulate two runners claiming one item → one wins
# expire a lease → sweep reclaims
```

## Verification Log

- 2026-06-09: claims suite green (8 tests): acquire+lease+assign; concurrent
  race → one winner, loser releases; live-lease rejection; expired-lease
  reclaim; live-claim not cleared; serialize_by deferral; lease renewal;
  full release.
- 2026-06-09: runner race test green: event + sweep concurrently on one item →
  exactly one dispatch, one marker comment. This test caught (and the claimant
  nonce fixed) a real double-dispatch bug — see Decisions.

## Decisions

- CAS = claim label + assignment, then RE-READ + deterministic tie-break
  (lexicographically lowest claim marker wins, computed identically by all
  racers). Comment markers rejected (slower, unbounded growth).
- **Two-phase lease**: only the race WINNER stamps the lease. A claim without a
  lease reads as expired → self-heals if a runner crashes between claim and
  lease. Loser removes only its own claim label.
- **Claimant nonce (race-test finding):** two invocations derive the same
  deterministic `runId` (0012), so identical claim labels would merge into one
  and both racers would "win" the CAS. The claim therefore uses an
  invocation-unique claimant token `<runId>~<nonce>`; the runId stays stable
  for records/markers/correlation. Without this, event-vs-sweep races
  double-dispatch — proven by the runner race test before the fix.
- Claim labels compact deterministically (`claimMarker`) to fit GitHub's
  50-char label limit for long custom-loop names.
- Default lease TTL: 30 min (`DEFAULT_LEASE_TTL_MINUTES`), configurable per
  call; renewal on ingest progress.
- `serialize_by` granularity: a free-form area string per loop (e.g. a service
  or path-glob name) — advisory, enforced at claim time.

## Risks / Rollback

GitHub's lack of true atomicity means the claim is best-effort + reconciled; the
re-read tie-break and idempotency key (0012) must both hold or a rare race could
double-dispatch. Conservative default lease + the M05 · 0073 correlation handle
are the backstops.

## Final Summary

GitHub-as-lock claiming: label-based optimistic CAS with re-read +
deterministic tie-break, invocation-unique claimant tokens (the fix for the
same-runId double-dispatch race the tests caught), winner-only lease stamping
(crash self-healing), renewal, advisory `serialize_by` area locks, full
release, and sweep reclaim of expired markers. Pure protocol in core, IO in
`@loopdog/github`, proven against the fake with race/recovery/serialization
tests.
