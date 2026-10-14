# Audit remediation — 2026-10-14

All implementation remains local. No push, production migration, configuration change or deployment was performed.

The subsequent Astra audit found nine additional issues. They are now repaired and independently re-reviewed; see [the final remediation report](astra-remediation-2026-10-14.md).

The remaining Supabase CI and authenticated browser checks are also complete; the latest release evidence is in [predeployment readiness](predeploy-readiness-2026-10-14.md).

## Decisions and verification

| Issue | Final implementation | Preservation check / consequence if incorrect |
|---|---|---|
| Heavy analysis history and newest-50 cap | Small summary pages with timestamp/ID cursors; complete history; streamed full detail on explicit access | Tests include 132 snapshots, concurrent deletion/insertion, session changes, graph and comparison equivalence. Incorrect projection would change investigation facts. |
| Oversized backup response | Stream complete JSON with bounded chunks, after all source reads have succeeded | A >5 MB Unicode backup round-trips without dropped rows. Failed source reads return an error before the stream starts. |
| Foreign IDs / partial cloud restore | One service-role-only invoker RPC transaction; all record and parent ownership checked under ordered table locks | Disposable Postgres tests prove late failures roll back earlier tables and other tenants' records stay intact. Local numeric search IDs are excluded. |
| Schema drift in flag types | RPC converts flags according to actual target column types | SQL tests run against BOOLEAN and production-like INTEGER schemas. No live column conversion is required. |
| Failed local backup / write ordering | SQLite mutation and serializable backup job commit together; ordered persistent replay with retries | Disk enqueue failure rolls back local mutation; jobs survive restart; delayed writes cannot overtake deletes; natural IDs preserve cloud/local identity. |
| Sync/restore concurrency | Shared maintenance context excludes writes and payment runners while retaining SELECT access | New and pre-prepared writes are blocked; startup reads/merge and restore stay within the maintenance scope. This scope assumes one local Node server. |
| Unavailable scheduled execution | Auto-Send UI offers manual mode on Vercel; APIs reject unsupported/serverless intervals | Browser and API tests confirm unavailable intervals cannot be saved. Existing manual execution remains available. |
| Dependency advisories | Compatible security patches; SDK major version preserved | Full unit/browser/build checks; production npm audit reports zero advisories. |

## Deliberately pending production actions

- Apply `supabase/migrations/20261014120906_atomic_local_restore.sql` before using local-to-cloud restore after release. Missing RPC fails closed with 503, with no unsafe fallback.
- Supabase leaked-password protection remains disabled because the organization is on Free and the feature requires Pro. No paid-plan upgrade was authorized or performed. It is an external Auth setting, not an application-code switch.
- The full npm advisory report still lists five development-only entries from one unpatched `braces` dependency chain used by ESLint. `braces` 3.0.3 is the latest published release; do not use `npm audit fix --force`, which proposes incompatible tooling downgrades. Runtime dependencies are clean in the current advisory report.
- Real production restore and real blockchain transactions were not run. The subsequent fixes include payment guards and consumed reward approvals in application export/restore; this export is still not a complete database snapshot. Preserve a database snapshot before a production recovery.

## Final checks

Unit tests, browser tests, TypeScript, ESLint, production build, production dependency audit, and disposable Postgres ownership/rollback/permission/type-compatibility checks pass. The working tree contains the reviewable implementation and migration.
