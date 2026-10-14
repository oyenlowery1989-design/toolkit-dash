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

`MAINNET_MAX_XLM_PER_DAY` is enforced through a shared reservation for saved-wallet signing, browser submissions (including manually entered keys), and server-run automations. The browser submits signed XDR through `/api/transactions/submit`, which checks the full transaction before forwarding it to Horizon. `ALLOW_BROWSER_SIGNING_KEYS=false` prevents exporting saved keys to the browser. A person who knows a manual secret can still submit outside this application; this policy controls only transactions sent through the app. During the first 24 hours after enabling the shared budget, reconcile earlier Auto-Send and Tiered Rewards payments because their past transactions are not backfilled into the new reservation table.

## Deployment order

These steps describe an initial installation. For the existing deployment's audited recovery update, use the release checklist below; do not reset the database or re-run the full schema as a substitute for the reviewed migration.

1. Apply `supabase-schema.sql`, then `supabase-rls-migration.sql` using a privileged migration connection.
2. Run `supabase test db`; all tenant-isolation tests must pass.
3. Deploy with mainnet transactions disabled and browser signing disabled.
4. Authenticate as the intended operator and `GET /api/admin/health`. Resolve every encryption or plaintext-key warning.
5. `GET /api/security/secrets`, then `POST /api/security/secrets` once to encrypt legacy plaintext keys. Repeat the GET and require zero plaintext keys.
6. Run `npm run drill:backup` against a disposable dual-provider deployment. Use validation-only mode first; set `DRILL_CONFIRM_DISPOSABLE=DISPOSABLE` only on a target that can be overwritten.
7. Verify browser safety tests and CI are green.
8. Set explicit limits and, if practical, a destination allowlist. Only then set `MAINNET_TRANSACTIONS_ENABLED=true` and redeploy.

## Audited recovery update — release checklist

Preparation is local until deployment is explicitly authorized. Do not push a deployment-triggering branch during preparation.

1. Preserve a complete database backup, including the server-only signing budget, issuance claims, and payment/reward recovery records. Keep the existing encryption and approval secrets stable.
2. Confirm the previous bulk-payment journal migration is already present. Apply only the pending `supabase/migrations/20261014120906_atomic_local_restore.sql` using the approved production migration process. It adds/replaces one restore function and limits execution to `service_role`; it does not replace user tables or rewrite their contents.
3. Verify that `restore_local_backup(text,jsonb)` exists, uses invoker permissions, and cannot be executed by `anon` or `authenticated`. Do not exercise the restore function on production data as a smoke test. A missing function safely disables local-to-cloud restore with HTTP 503.
4. Commit the reviewed source, new regression tests and migration together as the configured Git user; publish/deploy only after authorization. Preserve the approved 10,000 XLM per-run and 10,000 XLM per-day limits and existing signing safety controls.
5. After deployment, check the authenticated health endpoint, wallet/analysis/group loading, and Payments recovery state without sending funds. A journal whose outcome is uncertain must remain blocked; never clear it merely to permit another payment.
6. Confirm no new runtime errors or authorization failures. For an application rollback, preserve all journals/consumed approvals and pause transaction execution until pending hashes are reconciled; an older UI may not enforce the new recovery controls.

Local verification commands include `npm test`, `npm run test:e2e`, `npm run test:e2e:session`, TypeScript, lint/build, and the `database-security` job's Supabase/TAP plus BOOLEAN/INTEGER restore assertions. The session suite uses real browser/SDK state changes with isolated test responses and cannot submit live transactions.

## Health and alerting

Poll the authenticated `GET /api/admin/health` endpoint every five minutes with a restricted operator token. Alert on HTTP 5xx, `ok: false`, new warnings, plaintext secrets, or nonzero payment failures in the previous 24 hours.

Run `npm run check:production-health` with `HEALTH_BASE_URL` and `HEALTH_BEARER_TOKEN` set in a private environment. The command exits nonzero for authentication failures, warnings, payment failures, missing encryption, browser signing, or limits other than the approved 10,000 XLM per run and per day. It never prints the bearer token. A Supabase user access token expires, so do not put a one-time browser token into an unattended scheduler; use a restricted, renewable operator credential before scheduling this command.

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

The in-app JSON export and `/api/db/restore` cover user data, not the server-only `mainnet_signing_budget` and `asset_creator_issuance_claims` tables. Preserve these tables in platform/SQLite database snapshots. After restoring an older snapshot, keep mainnet execution disabled until every signature issued since that snapshot and every asset issuance is reconciled against Horizon. A missing issuance claim can permit another mint; an incomplete daily budget can permit spending past the configured cap. An expired issuance claim remains locked: inspect its stored `unsigned_hash` on the correct network and reconcile the ledger before any manual database correction. Never clear a claim just to make Retry work.

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
