# deploy

Deterministic loop — no work cell. Deployment runs through the project
adapter's deploy plan (see `.looper/looper.yml` `adapter:`); the smoke/health
gate promotes `deploying -> deployed` and failures trigger the rollback loop.
