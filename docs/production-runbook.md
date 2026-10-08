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

1. Apply `supabase-schema.sql`, `supabase-rls-migration.sql`, then `supabase-execution-migration.sql` using a privileged migration connection.
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

## Audit remediation rollout

Keep mainnet disabled throughout the rollout. Apply `supabase-execution-migration.sql`
after the existing schema and RLS migrations, then deploy the matching application.
It adds the service-only execution ledger, persistent schedule cursors, one-time
preview approvals, and immutable tenant ownership triggers. Run all SQL security
and budget tests before enabling execution. Ownership reassignment is intentionally
rejected even for service-role writes; use a separately reviewed migration if you
need to transfer a tenant's data.

All application classic and SAC submissions now pass through the server gateway.
The gateway inspects signed XDR, validates source signatures, enforces mainnet
incident controls and destinations, and atomically reserves a single rolling
**deployment-wide** daily budget across users, accounts and modules. XLM fees,
path-payment maximums, funding and native offer liabilities count toward it. Offer
liabilities are charged conservatively rather than refunded based on fills.
Market trades with unknown counterparties are blocked when a destination allowlist
is configured. Account merge must be submitted alone so the outgoing balance can
be bounded. Unsupported operation classes (including arbitrary contract calls and
liquidity-pool deposits) fail closed until they have an explicit spending policy.
This boundary governs the application's submission paths, not transactions a key
holder independently sends outside the application.

A confirmed transaction hash is deduplicated. Reserved or uncertain executions
retain their allowance beyond 24 hours and block further submissions from that
source account. If a worker crashes or a response times out, call authenticated
`POST /api/transactions/reconcile` with `{ "hash": "..." }`. Only confirmed Horizon
ledger evidence settles the record. A 404 is not evidence that no funds moved and
never releases a hold. If it cannot be reconciled automatically (for example,
pruned history), stop affected schedules and reconcile through a reviewed operator
procedure with independent ledger evidence. Do not delete a reservation merely
to retry a payment. Failed run-log writes raise alerts but cannot remove the
durable spending hold. Legacy automation logs are imported conservatively during
rollout; fees or manual transactions made before the gateway existed cannot be
reconstructed from those logs alone.

SQLite remains a private, single-operator backend. For authenticated SQLite
hosting set `SQLITE_OPERATOR_USER_ID` to the intended Supabase user; all other
users are rejected even with a valid JWT. The development-only authentication
opt-out must remain restricted to a private loopback environment. Use Supabase
for shared multi-user deployments. The SQLite recovery endpoint is available only
in single-operator SQLite mode; a shared Supabase deployment must use platform
recovery rather than this endpoint.

Supabase API exports are tenant data exports, not full deployment backups. Each
paged read checks exact counts and fails on detected source changes; pause writes
for a consistent recovery drill. Deployment disaster recovery must include a
Supabase database/platform backup containing `mainnet_executions`,
`scheduled_jobs`, and `used_preview_approvals`. Losing or reverting that ledger
can invalidate spending and replay protections. Never enable mainnet on a restored
instance until its ledger is reconciled with the network. Private SQLite exports
include this operational state. Preserve the encryption key separately in the
secret manager. Scanner keys and fallback hit logs are encrypted; production key
reads obey the same browser-signing opt-in as wallets.

Schedules use persistent minute-resolution interval cursors rather than truncating
minutes to cron hours. A 90-minute interval remains 90 minutes; restarts skip
missed ticks instead of replaying payments. Changing an interval starts a new
countdown. Cron claims a due attempt once before execution; an interrupted attempt
is not automatically repeated in that interval. Transaction leases and source
holds protect overlap and uncertain sends. Disabling then re-enabling a schedule
may make the first enabled tick due immediately if its persisted cursor elapsed.

For Vercel, set a high-entropy `CRON_SECRET` securely and enable the minute cron
in `vercel.json`. Your hosting plan must support that frequency and sufficient
function duration; another scheduler can call `GET /api/cron/automation` every
minute with `Authorization: Bearer <CRON_SECRET>`. Keep this credential separate
from user JWTs and encryption keys. Large runs that exceed the function duration
need a persistent worker, not repeated function retries. A configured secret alone
does not prove the provider enabled the cron; verify invocation logs with preview
schedules before allowing actual sends.

The TOML fetcher pins validated public DNS answers to HTTPS socket lookup while
retaining certificate verification. Horizon proxy reads require authentication,
have actual streamed byte limits, and a request deadline. Its 600/minute quota is
per user **per process**; configure a shared ingress quota for distributed hosting.

For an existing deployment, pause actual sends during migration and reconcile the
previous 24 hours across every application feature and external signer. Historical
manual sends and missing logs cannot be inferred from automation logs. Wait out
that window or seed a conservative reviewed ledger baseline before enabling the
new deployment-wide budget. Do not delete execution rows or restore a stale ledger
while transaction execution remains enabled.
