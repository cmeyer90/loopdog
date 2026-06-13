# Examples

A runnable example repo Looper is attached to — a copyable template and the
executable proof the [Quickstart](quickstart.md) works.

## `examples/node-todo`

A tiny Node todo library ([`examples/node-todo/`](../examples/node-todo/)) with a
full Looper attachment. It's validated and exercised in CI offline (no quota):

- the committed `.looper/looper.yml` + loop folders **validate** against the
  `@looper/config` schema, and
- a scenario test drives groom→implement over it on the in-memory **fake GitHub +
  fake backend** (M18), asserting the resulting labels, the correlated PR, the
  plan-as-contract, and the run records against a golden snapshot.

> Test: `packages/testing/test/example-node-todo.test.ts`; golden:
> `packages/testing/test/fixtures/goldens/example-node-todo.golden.json`.

### Concept → file map

| Concept | File |
|---|---|
| The app under change | `examples/node-todo/src/todo.js` (+ `test/`) |
| The attachment root | `examples/node-todo/.looper/looper.yml` |
| A loop, as data | `examples/node-todo/.looper/loops/implement/{loop.yml,prompt.md}` |
| Event trigger (low latency) | `.github/workflows/looper-events.yml` |
| Cron reconcile (resilience) | `.github/workflows/looper-sweep.yml` |
| Deploy verification | `.github/workflows/looper-deploy.yml` |

### The worked trace

Seeding a groomed `looper:state/ready-for-agent` issue and running the controller
(act mode, for the trace) produces:

1. **implement** dispatches a work cell to your subscription → the issue moves to
   `looper:state/in-progress` (a `pending` run record, the dispatch marker
   persisted for crash-safe correlation).
2. the work cell opens a PR carrying the `looper-run:` trailer; the next pass
   **ingests** it by correlation (0073) → `looper:state/in-review`, the PR labeled,
   the durable plan updated.

The review → fix → merge → deploy continuation is the same machinery; see the
[architecture walkthroughs](walkthroughs/) for the full lifecycle.

### Fork and attach

```bash
cp -r examples/node-todo my-project
cd my-project && looper login && looper connect
# open a test issue → watch groom post a plan → looper promote groom --to act
```
