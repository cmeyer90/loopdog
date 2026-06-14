import type { ControllerOptions } from '@loopdog/runtime';
import { handleEvent, handleSweep } from '@loopdog/runtime';
import type { RunRecord } from '@loopdog/core';
import type { FakeGitHub } from '../fake-github/fake-github.js';
import type { VirtualClock } from './clock.js';
import { ALL_INVARIANTS, checkInvariants, type Invariant, type Violation } from './invariants.js';

/**
 * Deterministic simulation engine (task 0086). Drives the REAL controller
 * (handleEvent / handleSweep) through the fakes under a virtual clock, an
 * explicit action schedule, and a fault overlay — then checks the core
 * invariants after every step and at quiescence. No wall-clock, no network,
 * no quota; a single seed makes the whole run reproducible.
 */

export type Action =
  | { kind: 'event'; name: string; payload: Record<string, unknown>; label?: string }
  | { kind: 'sweep'; label?: string }
  | { kind: 'advance'; ms: number }
  | { kind: 'concurrent'; actions: Action[]; label?: string }
  /** crash the NEXT invocation after its K-th op of `op` kind (mid-run abort). */
  | { kind: 'crashAfter'; op: string; count: number; then: Action; label?: string };

export interface StepResult {
  action: Action;
  records: RunRecord[];
  /** An error the invocation threw (crash/fault injection) — swallowed, state left partial. */
  error?: string;
  violations: Violation[];
}

export interface SimOptions {
  opts: ControllerOptions;
  clock: VirtualClock;
  gh: FakeGitHub;
  invariants?: Invariant[];
  /** Throw on the first violation (default true). */
  failFast?: boolean;
}

export class Sim {
  readonly trace: string[] = [];
  readonly steps: StepResult[] = [];
  private readonly invariants: Invariant[];

  constructor(private readonly s: SimOptions) {
    this.invariants = s.invariants ?? ALL_INVARIANTS;
    // The fakes read the same virtual clock as the controller.
    this.s.gh.clock = s.clock.now;
    this.s.opts = { ...s.opts, now: s.clock.now };
  }

  /** Execute one action, then evaluate invariants against the resulting state. */
  async step(action: Action): Promise<StepResult> {
    this.trace.push(describe(action));
    let error: string | undefined;
    const records = await this.runAction(action).catch((e: unknown) => {
      error = e instanceof Error ? e.message : String(e);
      return [] as RunRecord[];
    });
    const violations = checkInvariants(
      { gh: this.s.gh, records: this.collectRecords(), now: this.s.clock.now },
      this.invariants,
    );
    const result: StepResult = { action, records, violations, ...(error ? { error } : {}) };
    this.steps.push(result);
    if (this.s.failFast !== false && violations.length > 0) {
      throw new SimViolation(violations, this.trace);
    }
    return result;
  }

  async run(actions: Action[]): Promise<void> {
    for (const a of actions) await this.step(a);
  }

  /**
   * Drain remaining work: keep sweeping (advancing the clock between ticks so
   * leases/backoff can expire) until a tick is idle or maxTicks is hit. Proves
   * dropped/crashed work is recovered by the sweep, not stranded.
   */
  async runToQuiescence(maxTicks = 8, advanceMsPerTick = 60_000): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
      const before = this.collectRecords().length;
      await this.step({ kind: 'advance', ms: advanceMsPerTick });
      await this.step({ kind: 'sweep', label: `quiesce-${i}` });
      const after = this.collectRecords().length;
      if (after === before) break; // idle tick → quiescent
    }
    // Final invariant pass at quiescence.
    const violations = checkInvariants(
      { gh: this.s.gh, records: this.collectRecords(), now: this.s.clock.now },
      this.invariants,
    );
    if (this.s.failFast !== false && violations.length > 0) {
      throw new SimViolation(violations, this.trace);
    }
  }

  private async runAction(action: Action): Promise<RunRecord[]> {
    switch (action.kind) {
      case 'advance':
        this.s.clock.advance(action.ms);
        return [];
      case 'event': {
        const r = await handleEvent(this.s.opts, action.name, action.payload);
        return r.records;
      }
      case 'sweep': {
        await handleSweep(this.s.opts);
        return [];
      }
      case 'concurrent': {
        // Interleave invocations against the SAME shared fake state to expose
        // TOCTOU races (event + sweep both selecting an item before either claims).
        const results = await Promise.all(action.actions.map((a) => this.runAction(a)));
        return results.flat();
      }
      case 'crashAfter': {
        // Arm the fault: throw on the K-th op of the given kind, run the inner
        // action (aborting it mid-flight), then disarm — partial state remains.
        let n = 0;
        const prev = this.s.gh.beforeOp;
        this.s.gh.beforeOp = (op: string) => {
          prev(op);
          if (op === action.op && ++n === action.count) {
            throw new Error(`injected crash: ${op} #${action.count}`);
          }
        };
        try {
          return await this.runAction(action.then);
        } finally {
          this.s.gh.beforeOp = prev;
        }
      }
    }
  }

  private collectRecords(): RunRecord[] {
    // The InMemoryRunRecordStore exposes its full list; fall back to []`.
    const store = this.s.opts.records as { records?: RunRecord[] };
    return store.records ?? [];
  }
}

export class SimViolation extends Error {
  constructor(
    readonly violations: Violation[],
    readonly trace: string[],
  ) {
    super(
      `invariant violation: ${violations.map((v) => `${v.invariant} (${v.detail})`).join('; ')}\n` +
        `trace:\n  ${trace.join('\n  ')}`,
    );
    this.name = 'SimViolation';
  }
}

function describe(action: Action): string {
  switch (action.kind) {
    case 'event':
      return action.label ?? `event ${action.name}`;
    case 'sweep':
      return action.label ?? 'sweep';
    case 'advance':
      return `advance ${action.ms}ms`;
    case 'concurrent':
      return action.label ?? `concurrent[${action.actions.map(describe).join(', ')}]`;
    case 'crashAfter':
      return action.label ?? `crashAfter(${action.op}#${action.count}) ${describe(action.then)}`;
  }
}
