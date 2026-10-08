# Audit remediation — 2026-10-08

Changes were prepared against `a01eff1435add23942cb78b0ada5d36ca07166c7`.
The baseline audit is `/workspace/toolkit-audit/AUDIT.md` in the cloud workspace.
This report describes local verification; it does not establish readiness of an
existing production deployment. No funded keys or real ledger submissions were used.

## Changes by finding

| Finding | Result |
| --- | --- |
| F1: dependency advisories | Updated compatible runtime/transitive dependencies and overrides. Production audit has zero advisories. Five high-severity development-tool package entries remain in the ESLint/glob dependency chain, with no compatible fix reported by npm. |
| F2: tenant ownership | Bulk recipient/run writes insert first and update only an owned conflict. SQL triggers prohibit ownership reassignment, including service-role races in other upsert routes. |
| F3: execution controls | Browser tools, automation, and SAC deployment use a server policy gateway. Signed XDR is inspected and source signatures verified. Unsupported operations fail closed. |
| F4: daily budget | Atomic reservations enforce one deployment-wide budget, including fees and conservative native spending limits. Uncertain outcomes retain holds until ledger reconciliation. |
| F5: failed accounting | The execution ledger is independent of feature logs. Failed log writes surface as failures; submitted transactions with accounting errors require reconciliation. |
| F6: SQLite isolation | Authenticated SQLite access requires the configured single operator. Shared Supabase deployments cannot invoke SQLite recovery. |
| F7: incomplete backups | Tenant exports, recovery, startup sync and signing-key inspection page complete datasets with stable ordering and exact-count checks. Private SQLite backups include execution, schedule and approval state. |
| F8: TOML DNS rebinding | HTTPS sockets use the validated public DNS answers while retaining normal TLS hostname verification. DNS, connection time and streamed size are bounded; redirects are revalidated. |
| F9: proxy resource limits | Horizon proxy requires authentication, bounds paths/queries, enforces streamed byte and timeout limits, and has a per-process user quota. Distributed deployment quotas remain an ingress concern. |
| F10: scheduling | Persisted interval cursors support intervals such as 90 minutes and two days. Schedulers check once per minute; an authenticated cron endpoint and Vercel configuration support serverless hosting. |
| F11: scanner custody | Scanner database hits and fallback logs encrypt signing keys. Legacy migration includes scanner hits; production key reads obey the browser-signing opt-in. |
| F12: maintainability | Extracted shared transaction inspection, signature validation, durable execution, client submission and server-only SAC execution. Broader decomposition of large visual components remains incremental follow-up work. |

Preview approvals now carry unique nonces and are consumed once in durable storage.
Execution leases are revalidated immediately before each submission. Completed
process-local account locks are removed from the map.

## Verification

| Check | Result |
| --- | --- |
| Unit tests | 49 files, 309 tests passed |
| ESLint and TypeScript | Passed |
| Production build | Passed with Next.js 15.5.27 |
| Browser safety | All 3 existing tests passed using system Chromium 151 |
| PostgreSQL security and budget tests | All 26 pgTAP assertions passed |
| PostgreSQL concurrent reservations | Two connections reserving 60 against a budget of 100 produced one accepted reservation; stored usage was 60 |
| Authenticated API isolation | Real disposable GoTrue users and PostgREST service-role requests verified owner create/update, rejected cross-owner writes and isolated reads |
| Export pagination | All 1,201 expected address-book rows exported; the other user's export contained none |
| Recovery | Authenticated Supabase-to-SQLite recovery retained all 1,201 rows, rejected another SQLite user, included operational backup arrays and preserved before/after content fingerprints |
| Runtime dependency audit | Zero advisories with `npm audit --omit=dev` |
| Full dependency audit | Five high-severity development-tool package entries remain |

Database integration used disposable PostgreSQL 17, GoTrue 2.194.0 and PostgREST
14.15. The local `auth.uid()` fixture implements JWT claim lookup; production must
use Supabase's real auth schema and policies. The full Supabase CLI stack could not
start in this environment because of image/network and disk limits. The CI job is
configured; require GitHub CI to pass for the pushed commit before deployment.

The pinned Playwright Chromium download remains blocked by cloud egress policy.
System Chromium passed the existing suite; that suite covers three safety smoke
scenarios, not every interactive transaction tool or wallet-switch flow. Real
mainnet success, deployed cron delivery, hosted secret management and provider
platform recovery have not been exercised.

The remaining development advisories affect `braces`, `micromatch`, `fast-glob`,
`@next/eslint-plugin-next` and `eslint-config-next`. These are dependency-chain
package entries, not five independent exploit demonstrations. Do not downgrade
lint tooling or use a forced dependency update just to obtain a clean audit.

## Rollout

Follow [the production runbook](production-runbook.md), keeping mainnet disabled:

1. Review the changes, then commit/push them and run GitHub CI.
2. Back up the deployment and apply `supabase-execution-migration.sql` after the
   existing schema and RLS migrations.
3. Reconcile legacy/manual activity and preserve the global execution ledger in
   platform backups; tenant API exports do not include global operational tables.
4. Configure production auth, a stable encryption key, preview secret, conservative
   limits and a high-entropy `CRON_SECRET` through the deployment secret manager.
5. Verify hosted login, tenant isolation, key migration, recovery and actual cron
   invocation before enabling any execution.

The cron provider must support the configured one-minute cadence. Setting a secret
does not prove that invocations arrive. Losing the execution ledger or deleting
uncertain reservations can invalidate spending and replay protection.

Cloud startup instructions were refreshed in the environment configuration draft.
Review and save the draft in environment settings, then publish the environment
to activate the saved configuration/snapshot. Fresh-task restoration has not been
verified. Repository changes remain separate from configuration publication.
