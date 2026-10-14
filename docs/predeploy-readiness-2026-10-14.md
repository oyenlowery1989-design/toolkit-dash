# Predeployment readiness — 2026-10-14

Both previously outstanding checks are complete: the full Supabase database-security CI sequence and authenticated browser session changes during Payments signing. Five additional application defects were fixed. Astra's independent follow-up found no remaining confirmed defect in the reviewed auth-isolation patch. All integrated checks below have passed; the local source is ready for the authorized release procedure.

Release preparation update: the authorized PostgreSQL password reset and local `DATABASE_URL` configuration are complete. A consistent production snapshot was exported and encrypted; all 134 saved-analysis rows were restored in isolated PostgreSQL and matched their source hashes. The custom archive containing schema and all remaining table data passed a complete `pg_restore` read. The prepared atomic-restore migration was then applied successfully. Commit, push and deployment verification follow. No real blockchain transaction or production restore was performed.

Later AFLWA follow-up: automatic distributor inference now follows verified claimable-balance receipts. The latest full unit/API suite is **636 tests / 107 files**, with TypeScript, lint, build and a real read-only Horizon check passing. See [the AFLWA fix report](aflwa-distributor-fix-2026-10-14.md). Browser and database results below record the preceding auth-readiness run. The backup obstruction was resolved by exporting the large saved-analysis rows in verified 32 KiB fragments from the same exported snapshot as the remaining database archive. Backup artifacts and their separate encryption key are private, ignored local files; no credentials enter Git.

## Additional fixes

| Failure | Repair and regression evidence |
|---|---|
| Restored authentication could leave mounted wallet/data caches empty | Set the new bearer token, invalidate old-owner caches, and dispatch the existing sync event. Browser reload now loads saved wallets without a focus/storage workaround; cache generations still reject old responses. |
| Switching users retained the previous owner's manual secret and payment drafts | Reuse the local payment reset on owner changes. Send/path/claim/fee-bump fields, secret, memo, dialogs, and pending path lookup state clear. Same-owner refresh preserves drafts. Auth reset never acknowledges a server journal. |
| A late failed payment restored the previous owner's trustline prompt | Reject stale continuations before interpreting operation errors or performing fallback UI work. The browser regression checks private details stay hidden and no journal acknowledgement is sent. |
| A late account/offer lookup left the new owner stuck in Signing | Check owner generation after account loading, each offer page, signing, fallback creation and submit completion, including Fee Bump. Three delayed-lookup regressions leave the new session idle. |
| A late trustline retry showed the old wallet result or reopened confirmation | Capture owner/auth/signer identity and validate after lookup, signing and submission; suppress stale error UI. Owner reset clears the busy flag. Same-owner retry remains functional. |

Production code changes for this follow-up are confined to `hooks/use-auth.ts` and `components/payments/usePaymentsController.ts`. The existing shared reset is reused, with no new abstraction or dependency. Dedicated session tests run separately from local-mode browser tests through `npm run test:e2e:session`, now included in CI.

## Verification

| Check | Final result |
|---|---|
| Full unit/API suite | **602 passed across 106 files** |
| Existing browser suite | **18 passed, 26.1 seconds** |
| Authenticated session browser suite | **14 passed, 25.8 seconds** via the new npm command |
| TypeScript, full ESLint and CRLF-aware diff whitespace check | Passed |
| Production build | Passed; all 84 static pages generated |
| Runtime dependency audit | **0 advisories** |
| Supabase tenant-isolation TAP | **14 assertions passed** |
| Atomic restore SQL integration | BOOLEAN and INTEGER variants passed and rolled back |

Browser tests use isolated local SQLite, Mainnet disabled, and deterministic mocked external responses. The installed Supabase SDK handles real persisted-session/BroadcastChannel transitions. Cases cover A→B and A→B→A, restored wallet loading, genuinely rotated access tokens, delayed signatures/recovery/success/failure, lookup pagination, trustline retries and Fee Bump. The positive signing case verifies the cryptographic signature and exactly one simulated submission.

Database verification used Supabase CLI **2.111.0**, matching CI, and a complete isolated local Supabase stack on PostgreSQL 17. It ran the exact database-security job sequence: start, apply schema, apply RLS, `supabase test db`, and both `scripts/sql/atomic_restore.sql` variants. No production credentials/data or remote link metadata were copied. The stack and temporary Colima runtime were stopped after verification. GitHub-hosted CI itself was not triggered because no push was performed.

[Astra's final review](astra-predeploy-auth-review-2026-10-14.md) also independently exercised the actual controller functions: late account/payment errors caused no UI writes; six stale trustline continuations caused no UI/toast/confirmation events; a same-owner retry still opened confirmation. These source-extraction harnesses supplement the repository's browser regressions.

## Release handoff and remaining limits

Use the [audited update checklist](production-runbook.md#audited-recovery-update--release-checklist). At the authorized release, preserve a complete database backup and existing secrets, verify the earlier payment-journal migration, apply the pending `supabase/migrations/20261014120906_atomic_local_restore.sql`, and publish the reviewed source/tests together. Preserve the approved **10,000 XLM per run / 10,000 XLM per day** controls. Missing restore RPC fails closed; do not use production restore as a smoke test.

- No live blockchain transfer, production restore, live Supabase login/outage, or deployment smoke test was performed. Those limits are separate from the completed local database and browser checks.
- The ordinary parallel browser run logged a Next dev `Error: aborted` while all 18 assertions passed; the authenticated suite passed without that message. The production build emitted the previously observed `Buffer()` deprecation warning and completed successfully.
- Existing external/tooling limits remain: leaked-password protection requires a Supabase plan upgrade; the previous audit recorded five development-only ESLint dependency advisories. Runtime dependencies have zero advisories. No paid upgrade or forced dependency downgrade was attempted.
- Unknown payment outcomes intentionally stay blocked when retained ledger history cannot prove their result. Preserve journals and reconcile pending hashes before retries or an application rollback.
- Vercel MCP access is available for deployment and runtime verification. CLI 64.1.0 was tried through `npx` without a global installation; its local login is unavailable, so the release uses the existing Git deployment integration and authenticated MCP verification.

Earlier audit scope and fixes: [nine-issue Astra remediation](astra-remediation-2026-10-14.md), [previous remediation](audit-remediation-2026-10-14.md).
