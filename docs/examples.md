# Examples

A runnable example repo Loopdog is attached to — a copyable template and the
executable proof the [Quickstart](quickstart.md) works.

## `examples/node-todo`

A tiny Node todo library ([`examples/node-todo/`](../examples/node-todo/)) with a
full Loopdog attachment. It's validated and exercised in CI offline (no quota):

- the committed `.loopdog/loopdog.yml` + loop folders **validate** against the
  `@loopdog/config` schema, and
- a scenario test drives groom→implement over it on the in-memory **fake GitHub +
  fake backend** (M18), asserting the resulting labels, the correlated PR, the
  plan-as-contract, and the run records against a golden snapshot.

> Test: `packages/testing/test/example-node-todo.test.ts`; golden:
> `packages/testing/test/fixtures/goldens/example-node-todo.golden.json`.

### Concept → file map

| Concept | File |
|---|---|
| The app under change | `examples/node-todo/src/todo.js` (+ `test/`) |
| The attachment root | `examples/node-todo/.loopdog/loopdog.yml` |
| A loop, as data | `examples/node-todo/.loopdog/loops/implement/{loop.yml,prompt.md}` |
| Event trigger (low latency) | `.github/workflows/loopdog-events.yml` |
| Cron reconcile (resilience) | `.github/workflows/loopdog-sweep.yml` |
| Deploy verification | `.github/workflows/loopdog-deploy.yml` |

### The worked trace

Seeding a groomed `loopdog:state/ready-for-agent` issue and running the controller
(act mode, for the trace) produces:

1. **implement** dispatches a work cell to your subscription → the issue moves to
   `loopdog:state/in-progress` (a `pending` run record, the dispatch marker
   persisted for crash-safe correlation).
2. the work cell opens a PR carrying the `loopdog-run:` trailer; the next pass
   **ingests** it by correlation (0073) → `loopdog:state/in-review`, the PR labeled,
   the durable plan updated.

The review → fix → merge → deploy continuation is the same machinery; see the
[architecture walkthroughs](walkthroughs/) for the full lifecycle.

### Fork and attach

```bash
cp -r examples/node-todo my-project
cd my-project && loopdog login && loopdog connect
# open a test issue → watch groom post a plan → loopdog promote groom --to act
```
