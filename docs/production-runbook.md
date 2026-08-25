# Production runbook

This project supports Stellar Mainnet only. Transaction execution is fail-closed: keep it disabled until the deployment, database policies, key migration, limits, and alerts below have all been verified.

Use Node.js 22 or newer for development, CI, and production. Current `@supabase/supabase-js` releases used by this project require Node.js 22+.

## Required production configuration

Set these in the deployment secret manager, never in a committed `.env` file:

- `DB_PROVIDER=supabase`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SIGNING_KEY_ENCRYPTION_KEY`: exactly 32 random bytes encoded as base64 or 64 hexadecimal characters
- `PREVIEW_APPROVAL_SECRET`: a separate high-entropy secret
- `ALLOW_UNAUTHENTICATED_LOCAL=false`
- `ALLOW_BROWSER_SIGNING_KEYS=false`
- `MAINNET_TRANSACTIONS_ENABLED=false` for initial deployment
- `MAINNET_EMERGENCY_STOP=false`
- conservative `MAINNET_MAX_XLM_PER_RUN`, `MAINNET_MAX_XLM_PER_DAY`, and `MAINNET_MAX_OPERATIONS_PER_RUN`
- `MAINNET_ALLOWED_DESTINATIONS` when payments should be restricted to known addresses

Keep the encryption key stable across deployments. Losing it makes encrypted signing keys unrecoverable. Rotate it only with a planned decrypt-and-reencrypt migration.

## Deployment order

1. Apply `supabase-schema.sql`, then `supabase-rls-migration.sql` using a privileged migration connection.
2. Run `supabase test db`; all tenant-isolation tests must pass.
3. Deploy with mainnet transactions disabled and browser signing disabled.
4. Authenticate as the intended operator and `GET /api/admin/health`. Resolve every encryption or plaintext-key warning.
5. `GET /api/security/secrets`, then `POST /api/security/secrets` once to encrypt legacy plaintext keys. Repeat the GET and require zero plaintext keys.
6. Run `npm run drill:backup` against a disposable dual-provider deployment. Use validation-only mode first; set `DRILL_CONFIRM_DISPOSABLE=DISPOSABLE` only on a target that can be overwritten.
7. Verify browser safety tests and CI are green.
8. Set explicit limits and, if practical, a destination allowlist. Only then set `MAINNET_TRANSACTIONS_ENABLED=true` and redeploy.

## Health and alerting

Poll the authenticated `GET /api/admin/health` endpoint every five minutes with a restricted operator token. Alert on HTTP 5xx, `ok: false`, new warnings, plaintext secrets, or nonzero payment failures in the previous 24 hours.

Create log alerts for:

- `[admin/health] health check failed`
- `[security/secrets] migration failed`
- `[auto-send/run]` errors or run-log write failures
- `[tiered-rewards]` errors or run-log write failures
- repeated 401/403 responses on authenticated API routes

Treat a failed run-log write as a payment incident because it can make daily-limit accounting incomplete. Activate `MAINNET_EMERGENCY_STOP=true` until accounting is reconciled.

## Backup and recovery drill

The drill script validates every table exported by the selected provider without writing a plaintext backup file. SQLite exports also include the local-only tracer and key-scanner tables. Restore mode calls the existing recovery endpoint and verifies that a second export contains no row-count regressions.

```sh
DRILL_BASE_URL=https://disposable.example \
DRILL_BEARER_TOKEN=... \
npm run drill:backup
```

To exercise restore only on a disposable target:

```sh
DRILL_BASE_URL=https://disposable.example \
DRILL_BEARER_TOKEN=... \
DRILL_RESTORE_SOURCE=supabase \
DRILL_CONFIRM_DISPOSABLE=DISPOSABLE \
npm run drill:backup
```

Also schedule Supabase platform backups according to the required recovery-point objective. At least quarterly, restore a platform backup into an isolated project, apply the current application, run the health check, verify record counts, and confirm that encrypted keys decrypt with the production encryption key supplied through the isolated secret manager.

Database backups contain Storage metadata, not the stored objects themselves. If Supabase Storage is added to this application, back up and restore those objects separately.

## Incident controls

For suspected key exposure, payment duplication, broken limit accounting, or unexpected destinations:

1. Set `MAINNET_EMERGENCY_STOP=true` and redeploy immediately.
2. Disable affected schedules in the database.
3. Preserve application and database logs.
4. Reconcile transaction hashes against Horizon and the run-log tables.
5. Rotate affected Stellar signing keys and application secrets.
6. Re-enable only after a preview matches the intended destinations and amount, and a second operator reviews it.

## Rollback

Application rollback is safe while `MAINNET_EMERGENCY_STOP=true`. Do not roll back database policies or encrypted-key columns independently of the application version. If a schema rollback is unavoidable, restore the last verified database backup into an isolated project first and confirm compatibility there.
