# 0013 Atomic Claiming & Serialization

Status: planned  
Branch: task/0013-atomic-claiming-and-serialization

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
unique claim label `looper:claimed-by/<run_id>` *and* assign the bot, then
**re-read** the item; if more than one claim marker is present (lost race), the
lower `run_id` wins and the loser releases and aborts. The assignment + single
claim label is the CAS; the re-read resolves the rare double-add.

**Lease/TTL.** The claim carries a timestamp (in the run record + a
`looper:lease/<iso8601>` marker). The cron sweep treats a claim older than the
lease (e.g. 30 min, configurable) as **expired** and may reclaim the item —
covering crashed/timed-out runs. Provider work that legitimately runs long renews
the lease on ingest progress.

**Per-area serialization.** A loop config may declare `serialize_by` (e.g. a path
glob or service). The runner takes an advisory lock label
`looper:lock/<area>` before claiming; if held by a live (non-expired) run, the
item is deferred to the next sweep rather than dispatched. This prevents two PRs
mutating the same area into a merge conflict.

**Release.** On terminal outcome the runner removes the claim/lease/lock markers;
the sweep removes expired ones.

## Out Of Scope

- The transition pipeline (0012); the state labels themselves (0011).

## Acceptance Criteria

- [ ] Two concurrent invocations targeting the same item result in exactly one
      claim; the loser aborts cleanly (race test).
- [ ] An expired-lease claim is reclaimable by the sweep (crash-recovery test).
- [ ] `serialize_by` defers a second item in the same area instead of dispatching
      it concurrently.
- [ ] Claims/leases/locks are released on completion and on failure.

## Implementation Checklist

- [ ] Implement the label-based claim + re-read race resolution.
- [ ] Implement lease stamping, expiry, and renewal-on-progress.
- [ ] Implement `serialize_by` advisory area locks.
- [ ] Implement release on terminal outcome + sweep cleanup of expired markers.

## Test Plan

```bash
# replace with the chosen stack's runner
# simulate two runners claiming one item → one wins
# expire a lease → sweep reclaims
```

## Verification Log

Add dated entries here as work proceeds.

## Decisions

Record the CAS mechanism chosen (label vs. assignment vs. comment marker), the
default lease TTL, and the `serialize_by` granularity.

## Risks / Rollback

GitHub's lack of true atomicity means the claim is best-effort + reconciled; the
re-read tie-break and idempotency key (0012) must both hold or a rare race could
double-dispatch. Conservative default lease + the M05 · 0073 correlation handle
are the backstops.

## Final Summary

Fill this in before marking verified.
