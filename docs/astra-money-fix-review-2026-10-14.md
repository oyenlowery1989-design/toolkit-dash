# Independent Astra review — money fixes

Final review of the current dirty tree against original audit findings 1–3. Read-only: no repository edits, live calls, transactions, commits or deployments.

## Result

**No remaining confirmed money-safety blocker found in the reviewed fixes.** All three original failures are addressed. Three additional recovery issues found during this independent review were returned to the parent and repaired before clearance.

### Original fixes verified

1. **Ordinary Payments response loss / duplicate retry:** The controller retains a computed hash and signed envelope before broadcast. The server atomically creates the durable `payment-guard` before forwarding, blocks different transaction hashes, returns recorded outcomes for repeated requests, and reconciles known ledger outcomes. UI reload retrieves the pending record, blocks rebuilding, and requires acknowledgement before a new payment. Same-hash rebroadcast remains protocol-identical rather than producing a new sequence.
2. **Tiered Rewards approval replay:** Every new preview receives a nonce. Atomic unique claims in the server-only journal table prevent both concurrent and sequential reuse; completed and partial outcomes are returned without running the distribution again. A lost outcome write leaves the original token consumed. A deliberate second distribution requires a new preview/nonce.
3. **Auto-Send approved-amount drift:** API passes its verified GroupPreview into the account-locked runner. Both batch and separate paths build the fixed approved amounts. An incoming deposit cannot increase them; insufficient remaining balance/reserve fails closed. Scheduled/test runs intentionally retain dynamic computation.

## Additional issues found and resolved during review

- **Never-included payment remained pending forever.** Initially only an indexed result or explicit `tx_failed` completed recovery. The parent added a canonical Stellar RPC checkpoint (`startLedger`) before journal creation/broadcast. A missing transaction is now resolved only when one RPC transaction response proves retained history covers that checkpoint and latest ingested close time is strictly beyond signed maxTime. Missing/pruned/lagging history stays unresolved. Horizon and RPC can independently confirm a positive outcome.
- **Completed Tiered outcome became unreadable after preview expiry.** Initially `readRewardApproval` rechecked token expiry and returned 428 after five minutes. Stored outcomes now use the exact token hash and authenticated user/config scope; expiry continues to gate new claims. Independently observed the regression fail 428-vs-200, then pass after repair.
- **Late Payments result could overwrite another user's session state.** Parent added generation guards to submission completion/catch and acknowledgement/reset, and clears transaction status/hash/error on auth change. Source review confirms the same session generation now protects these async mutations. Direct browser cross-user simulation remains with the parent.

## Recovery proof assessment

Read `lib/payments/submission-journal.ts` after the RPC change. The recovery condition uses `NOT_FOUND`, `oldestLedger <= startLedger`, `latestLedger >= startLedger`, and `latestLedgerCloseTime > maxTime`; it does not equate a generic 404 with failure. The checkpoint is durable before application broadcast. No-record storage/checkpoint failure prevents broadcasting.

For an imported fee-bump inner envelope, the checkpoint alone cannot cover an earlier external submission. The implementation separately looks up the inner hash and requires a positive minTime covered by RPC's retained history before proving absence. A missing imported envelope with minTime=0 therefore remains unresolved, intentionally. Old journal records without startLedger likewise fail closed. This conservative limit should remain documented; manually deleting these rows is not a safe normal recovery action.

## Ownership, concurrency and restore review

- Saved-key/auth boundaries remain intact; tracked submission does not bypass `requireAuth` or Mainnet policy/reservation.
- Payments resource IDs scope Supabase records by authenticated user and SQLite by the already owner-restricted local database. CAS transitions prevent overwriting a different active record. New ordinary payments block while any prior outcome is pending/unacknowledged.
- Tiered consumed approvals scope both config and user and use a hashed token resource ID; unique insert is the execution boundary. Permanent guard/approval rows do not collide with ordinary expiring config leases.
- Local maintenance checks `_paymentsInFlight`; in-flight ordinary payment submission cannot overlap a local restore. DB write guards also protect recovery updates.
- Backup/restore selectors and SQL guard branches recognize `payment-guard` and `reward-approval`. Local/cloud payment ID remapping is explicit, existing conflicting rows are rejected/preserved, and approval ownership derives from stored authenticated user/config metadata. Data agent/parent own comprehensive restore SQL tests and final schema validation.

## Independent verification

Final command:

`npx vitest run tests/api/payments-recovery.test.ts tests/api/distribution-approvals.test.ts tests/lib/tiered-rewards/approval.test.ts tests/lib/local-restore-lock.test.ts`

**4 files, 28 tests passed.** These cover durable response-loss blocking, identical and concurrent request behavior, explicit failed outcome acknowledgement, storage failure before broadcast, RPC absence with expired covered history, lag/pruning failure-closed behavior, imported fee-bump uncertainty/inner success, completed Tiered outcome replay including after expiry, partial/uncertain outcomes, new-token intentional runs, Auto-Send increase/decrease cases, and local restore exclusion/write protection.

Reviewed the actual current tests and code. Did not rerun the obsolete original standalone proof script, whose signatures predate these fixes. Parent owns integrated full-suite/browser/build checks.

## Remaining limits

- No live Mainnet, Horizon/RPC/Supabase requests or production RLS/restore execution. Tests simulate protocol responses; production provider availability and retained-history duration are not verified here.
- The RPC outage/insufficient-history, imported fee-bump minTime=0, and legacy missing-checkpoint cases intentionally keep a payment blocked. This prevents unsafe automatic retries but can require operator investigation.
- Full cross-user browser regression and browser presentation are not independently run by this reviewer; session repair is verified by source tracing.
- Review stayed within original money findings and introduced recovery/restore interactions; it is not a new exhaustive audit of every transaction UI or CRUD route.

Verdict: money fixes clear this independent code-and-focused-test review. No further implementation requested from this reviewer.
Skipped live execution and production state checks; unresolved history intentionally blocks a new payment rather than guessing its outcome.
