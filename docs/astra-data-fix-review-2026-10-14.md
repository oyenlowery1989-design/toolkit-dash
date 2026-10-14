# Final narrow re-review — RESOLVED

The remaining P2 approval identity roundtrip issue is resolved in the current tree. No new finding in this narrow review.

- Reviewed `normalizeApprovalGuardToken` in lib/backup-run-guards.ts:26 and both restore/startup-sync comparison call sites. Only reward-approval-prefixed tokens normalize userId `local` or the exact authenticated user to that authenticated user. Other receipt fields are preserved; foreign user IDs and other guard prefixes are unchanged. Existing local rows are retained through INSERT OR IGNORE, not overwritten.
- Re-ran `npx vitest run tests/api/db-restore.test.ts`: **25 tests passed**. The same file contains both restore and startup-sync actual-handler roundtrip tests (there is no separate tests/api/db-startup-sync.test.ts). Those tests push a local receipt with an outcome, pull it successfully, verify local token unchanged, push again identically, then confirm changed outcome and foreign-owner local receipts return **409** without mutation in both handlers.
- Independent in-memory assertions against the actual helper confirm allowed local/owner equivalence, while foreign-user/config/digest/outcome/extra-field changes remain unequal; payment/reward-guard prefixes and malformed input remain unchanged. Digest conflicts therefore follow the same tested 409 branch as outcome conflicts.
- The old `/tmp/astra-approval-roundtrip-repro.cjs` is historical and mocks the helper module without its new export; use the current actual-handler tests above as the executable regression proof.

Skipped: full suite/browser/build/production and repeated SQL runs; parent handles full checks. No implementation, repository, production, or external changes by reviewer. Only this /tmp review report updated.

---

## Historical initial review (finding subsequently resolved above)

# Independent data fix review

Read-only review of the working tree after /tmp/astra-data-fixes.md. Used codebase-memory first; index returned zero matches for the new symbols, then inspected current files directly. No repo edits or external writes.

## Finding requiring correction

P2 — A locally created reward approval does not survive the supported local→cloud→local round trip without a false conflict.

- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/restore/route.ts:364`–367 explicitly permits approval.userId === 'local' and rewrites that metadata to the authenticated cloud user when preparing the RPC payload.
- The original SQLite approval remains unchanged. A subsequent cloud restore compares the raw lease_token at restore route line 148; startup-sync does the same at line 136. Same config, token hash, digest and outcome now differ only in userId, and both paths return 409 before importing anything.
- Concrete prerequisite: local approval created before configuring a real sync identity, followed by enabling sync and pushing it. Existing configured deployments that already wrote the UUID do not hit this case.
- Executable actual-handler reproduction: `node /tmp/astra-approval-roundtrip-repro.cjs`. Uses in-memory better-sqlite3 and mocked cloud rows. Output: restore 409 "A local reward run guard differs; reconcile it before restoring"; startup-sync 409 "A local run guard differs; reconcile it before syncing".
- Minimal correction: canonicalize only the allowed local/authenticated-user metadata equivalence before immutable comparison and preserve every other conflict. Persist a compatible canonical representation deliberately; do not broadly overwrite guard metadata. Add an actual push/pull/startup roundtrip case including an outcome, plus a changed-outcome negative case.

## Original findings checked

- Boolean import: both routes normalize all known flag sites to Number; tests include true and false and all affected tables. Pass.
- Saved analysis export: full reader now uses timestamp/id cursor, count is per remaining page, and server-cap handling remains present. Concurrent insertion and deletion tests pass. No repeat of offset truncation found.
- Scanner maintenance: lock rejects running/dirty/active-worker state; start refuses maintenance; delayed checkpoint retains dirty state and retries. Focused tests pass.
- Cloud lists: groups/persons/wallets use full paged readers, child parent IDs batched; creator filtered reads use readPages. Sorting preserved. Group and creator failures return non-2xx. Completeness/error tests pass.
- SQL runner: plain assertion script moved to scripts/sql/atomic_restore.sql, no longer discovered by TAP; CI explicitly runs normal and integer-flags variants via psql ON_ERROR_STOP. Correct static integration.

## Cross-cutting guard review

- payment-guard cloud user ID is mapped to payment-guard:local on pull and mapped back to authenticated user on push. Existing differing lease_token blocks restoration.
- reward-guard ownership is validated through config ownership; reward-approval checks payload.userId and config ownership in SQL. Only supported prefixes enter restore.
- Existing SQL lease_token mismatch fails before insert; guard conflicts remain DO NOTHING, not overwritten. Service role-only execution remains enforced.
- readBackupRunGuards scopes payment IDs explicitly and filters approval metadata by user and owned config. It scans the global approval prefix with the service client; malformed approval metadata can fail any user's export. Current producers generate valid JSON, so this is a known fail-closed/scale limitation, not a reproduced current-user bug.
- Local/cloud operations are not one transaction across databases. Existing restore lock is intentionally same-process; no claim of distributed exclusion.

## Decisive checks run by this reviewer

1. `npx vitest run tests/api/db-restore.test.ts tests/lib/saved-analyses/server.test.ts tests/lib/local-restore-lock.test.ts tests/lib/key-scanner/loop.test.ts tests/api/wallet-read-failures.test.ts` — 5 files / 40 tests pass.
2. `npx vitest run tests/api/cloud-list-completeness.test.ts tests/lib/tiered-rewards/approval.test.ts tests/api/distribution-approvals.test.ts` — 3 files / 19 tests pass.
3. Executable independent approval-identity reproduction above confirms the remaining 409 issue.

Skipped: production/live Supabase, blockchain submission, browser/full build/full suite, and executing mutation-containing disposable SQL scripts (parent/data implementer already ran those). This review covers data/restore fixes and guard persistence, not a full independent review of payment controller execution behavior.
