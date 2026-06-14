# deploy-smoke

Deterministic loop — no work cell. Reads the `deploy` and `deploy-smoke`
check runs (your deploy workflow reports them) and promotes
`deploying -> deployed` on green or fails over to `deploy-failed` on red.
