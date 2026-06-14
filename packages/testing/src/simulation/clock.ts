import type { Clock } from '@loopdog/core';

/**
 * Deterministic virtual clock (task 0086). The runtime never blocks (no
 * sleep), so a clock is just an injectable `now()` — the `Clock` seam in
 * `@loopdog/core`, which the runner, sweep, preflight, controller, and
 * FakeGitHub already accept. The simulation owns all advancement, so
 * time-based behavior (backoff, lease expiry, quota windows, schedule
 * windows) is fully reproducible.
 */
export class VirtualClock {
  private t: number;
  constructor(start: string | number = '2026-06-09T12:00:00Z') {
    this.t = typeof start === 'number' ? start : Date.parse(start);
  }
  /** Pass this as the `now` (`Clock`) dep everywhere wall time is read. */
  now: Clock = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
  advanceMinutes(min: number): void {
    this.t += min * 60_000;
  }
  setTime(t: string | number): void {
    this.t = typeof t === 'number' ? t : Date.parse(t);
  }
}
