# rollback

Deterministic loop — no work cell. When an item lands in `deploy-failed`,
your CI's rollback job (the adapter's rollback command) runs and reports the
`rollback` check; green promotes `deploy-failed -> rolled-back` and the
deploy outcome is reported on the PR/issue and the durable plan.
