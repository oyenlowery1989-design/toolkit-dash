# Astra full-project audit — 2026-10-14

Remediation status: all nine findings below were subsequently repaired locally and reviewed again with Astra. See [the remediation and verification report](astra-remediation-2026-10-14.md). This document preserves the original audit evidence.

Performed by two GPT-6 Astra (high reasoning) reviewers on the current uncommitted working tree. Read-only audit; only this report is added. No application fixes, commit, push, production changes, or deployment in this audit round.

## Outcome

Eight behavioral failures reproduced in isolated actual-code checks; one SQL test-runner format incompatibility identified statically. Three money-flow findings deserve first priority. This is a broad risk-based review, not a claim that every line or production interaction was exercised. Detailed coverage and exclusions follow each subreport.

## Independent verification

- 101 unit test files / 555 tests passed.
- 17 browser tests passed against isolated local data with Mainnet disabled.
- TypeScript, ESLint and production build passed.
- Current npm production audit: zero advisories. Full dependency audit: five high entries in the development-only braces/micromatch/fast-glob/ESLint chain.
- Parent independently reran all three money reproduction assertions: all passed.
- Full Supabase CLI database CI was not run; SQL TAP incompatibility is a static finding, not a claimed observed CI failure.

## Priority index

1. P1: Payments lost response followed by retry can pay twice.
2. P1: Tiered Rewards accepts the same completed execution approval again.
3. P1: Auto-Send can recalculate a larger payment after preview approval.
4. P1: Cloud-to-SQLite restore/startup sync rejects boolean flags.
5. P1: Concurrent insertion can make full-history export omit an existing snapshot.
6. P2: Active scanner checkpoint can throw uncaught during restore maintenance.
7. P2: Unpaged cloud lists silently truncate at the configured API cap.
8. P2: Failed cloud group/creator reads can be returned as successful empty data.
9. P2: New psql-style SQL test is incompatible with configured TAP discovery.

# Money/security audit — current working tree

What this repo does: A Stellar Mainnet toolkit that signs user payments, creates/manages assets and accounts, and runs saved distributions. Assumed load: the documented single local server or authenticated Supabase deployment; no hostile access to the operator's private keys is needed for the failures below.

Read-only audit. No repository edits, live transactions, production mutations, or deployment. Evidence script and this report are in /tmp only. Reviewed the current dirty tree and remediation ledger; the resolved restore/backup/unsupported-schedule issues are not repeated.

## Must fix

### 1. [P1] Payments can pay twice after a lost submission response

**Primary location:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/components/payments/usePaymentsController.ts:665` (submission), `:750` (hash only captured on success), `:760` (all exceptions become failed/error state).
**Supporting location:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/transactions/submit/route.ts:41` returns a 502 with a warning to check a hash, but provides no hash; controller clears its previous hash when beginning the attempt.

- **What this is:** The ordinary Payments Send/Path/Claimable flows build and submit a fresh signed transaction for each confirmation.
- **Problem:** Horizon commits a 5 XLM payment but the response is lost. The API returns 502, and the controller displays “Transaction failed”, leaves `txHash` null and releases its submitting guard. The saved-wallet form can immediately be confirmed again; it loads the now-incremented sequence and sends another 5 XLM. A protocol hash/sequence deduplication cannot help because the retry is a different transaction.
- **Fix:** Retain the signed envelope and computed hash before broadcast, expose an unresolved state on transport/unknown failures, and reconcile or rebroadcast that same envelope before permitting a rebuilt transaction. Reuse the existing bulk-payment reconciliation/journal behavior rather than inventing another error classification. Include durable recovery if page reload is supported.
- **If skipped:** A routine timeout can transfer funds twice. Current per-day limits merely cap the loss; both 5 XLM transfers fit normal limits.
- **Verification:** Executed the actual `handleSubmit` function extracted from current source in an isolated VM with real SDK-built/signed transactions, a simulated advancing ledger, and stubbed React setters. First call committed, then threw the response-loss error: status `error`, hash `null`. Second call committed a second 5 XLM transaction with a different hash and sequence. No network was used.

### 2. [P1] Retrying the same Tiered Rewards execution can repeat the entire distribution

**Primary location:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/tiered-rewards/run/route.ts:140` (every valid token triggers a new run).
**Supporting locations:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/tiered-rewards/run-guard.ts:129` deletes a successfully completed run journal; `components/tiered-rewards/TierConfigCard.tsx:270` leaves the same preview/token available after fetch failure; `components/tiered-rewards/TierPreviewModal.tsx:198` re-enables Execute once `executing` becomes false, even with an error.

- **What this is:** A preview token authorizes the displayed reward distribution for five minutes. The durable journal correctly protects unresolved Horizon submissions and overlapping runs.
- **Problem:** The server successfully finishes a distribution, deletes the guard, and its HTTP response to the browser is lost. The modal keeps the same preview/token and enables Execute again. An identical POST passes token verification and sends the full rewards again with fresh sequences. This is a retry of the same approved action, not the user creating and approving a new distribution.
- **Fix:** Give each preview approval a unique run ID and atomically claim it before execution; keep the completed outcome for the token lifetime. Return that recorded result on a retry. A deliberate second distribution should require a fresh preview/run ID. Client-only button disabling cannot fix lost responses or repeated HTTP requests.
- **If skipped:** Every holder can receive twice the approved reward. Existing guards protect concurrent/uncertain runs but do not protect a successful run whose browser response disappeared.
- **Verification:** Called the real preview and run route handlers, real runner, and real SQLite journal in memory, with a deterministic holder preview and simulated Horizon. Two sequential identical run POSTs using one preview token both returned 200 / `totalSent: 1`; two distinct signed hashes were submitted. UI catch and disabled-button logic confirms a normal response-loss retry can reach this case. No network was used.

### 3. [P1] Auto-Send recalculates the amount after checking the approved preview

**Primary location:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/auto-send/run/route.ts:190` and `:202` verify a fresh preview and then call `runGroup(group)` without the approved amounts/digest.
**Supporting location:** `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/auto-send/runner.ts:275` and `:311` reload the balance and recalculate distribution amounts after approval verification.

- **What this is:** Auto-Send pays percentages of the current balance minus reserve and fee allowance.
- **Problem:** With 21 XLM, a 10 XLM reserve, 1 XLM fee allowance and one 100% recipient, preview approves 10 XLM. The run route sees the same 21 XLM and accepts that approval. A deposit arrives before the runner's next balance read, making the balance 31 XLM. The runner now sends 20 XLM without new approval. Both amounts remain below normal policy limits. Waiting on the per-account lock makes the window potentially longer than one HTTP round trip.
- **Fix:** Pass the verified payment plan into the runner and execute those fixed amounts, or recheck its digest under the account lock using the very same values used to construct transactions. Keep scheduled/test execution explicit because those paths intentionally have no manual preview approval.
- **If skipped:** An incoming deposit between two reads changes the amount the operator authorized.
- **Verification:** Exercised the real Auto-Send API, runner and durable guard against in-memory SQLite and the real SDK, with simulated account reads of 21 XLM for approval and 31 XLM for execution. Actual output: approved 10 XLM, returned `amountSent: 20`, and constructed/submitted a 20 XLM payment. No network was used.

## Decisive checks

`node /tmp/stellar-money-evidence.cjs` passed all three assertion groups. It loads/transpiles current source, uses real Stellar transaction construction and in-memory SQLite, and stubs auth/network/budget dependencies. The amounts used remain within default policy caps; budget stubbing does not create the approval or retry failures. It blocks external fetch calls. Output:

```
AUTO-SEND: approved 10 XLM; execution submitted 20 XLM after deposit between approval-check and runner reads.
TIERED REWARDS: identical run POST/token accepted twice sequentially, two distinct signed payment hashes.
PAYMENTS: first payment committed but response lost => error state and null hash. Reconfirm commits second 5 XLM payment with fresh sequence.
```

Parent independently reported 555 unit tests, 17 browser tests, TypeScript, ESLint, production build passing and zero production dependency advisories. I did not rerun that suite redundantly. Passing existing tests does not cover these reproduced cases.

## Coverage and limits

- Read applicable root guidance, relevant nested module notes, Ponytail audit skill, and the current remediation ledger. Codebase-memory search was used first to map signing/submission call sites.
- Deep review: auth/storage-mode boundary (`requireAuth`), saved-wallet ownership/key-address matching, generic and purpose-specific signing endpoints (wallet, Asset Creator, Asset Manager, Account Funder), Mainnet submission intent and rolling reservation store, preview signing, Auto-Send/Tiered execution and journals/leases, Tiered scheduling, ordinary Payments controller and retry/recovery UX.
- Focused adjacent review: bulk runner and its pre-broadcast checkpoint/uncertain reconciliation, Ghost native-underfunded prohibition and submission path, Asset Creator issuance recovery, trustline drain/remove and batch signing, Account Funder creation/verification paths, My Wallet claim/merge/home-domain signer-change guards, Asset Manager operation policy/trades helpers, Soroban deploy route/simulation/fee-reservation flow, secret encryption/migration API, Horizon and TOML proxy validation. Auth-presence inventory found only the DB status and Soroban check routes without direct `requireAuth`; no claim of a new auth bypass was made from presence alone.
- Full source was not read for every UI render branch or every CRUD handler. In particular this is not an independent exhaustive tenant-isolation review of all CRUD/restore routes, every Account Funder sponsored/close UI transition, every Ghost sender-mode combination, or every trade batch UI callback. Other assigned agents/parent cover data persistence and broader app behavior.
- Not runtime-verified: production RLS/schema/policies, live Supabase auth settings, live Mainnet state, genuine packet loss against Horizon, multi-process deployment scheduling, browser refresh/restart recovery. All evidence is isolated and deterministic.
- Residual suspicions deliberately not promoted to findings: Auto-Send treats `tx_bad_seq` as definite rejection while Bulk/Tiered treat it as ambiguous (needs protocol/provider scenario validation); TOML DNS validation and fetch resolve separately (rebinding concern, but no actual internal TLS exploit established here); shared global budget can be exhausted by rejected authenticated submissions (deployment-wide quota is an explicit documented policy, not enough evidence to call it a tenant security violation).

Verdict: fix the three approved-action/retry gaps before relying on Mainnet execution during network failures or incoming transfers.
Skipped live execution and production configuration checks. No repository changes; live exploitability beyond the reproduced application logic remains untested.


---

# Data/persistence audit — 2026-10-14

Scope: current working tree, read-only. Assumed one local SQLite Node server, a Supabase deployment used across devices, and saved groups/history exceeding 1,000 records. Read ponytail-audit, codebase-memory, Supabase skills; used graph discovery first. No repository or external data edits. Focused probes transpiled actual TypeScript in memory, used installed SDK with fake fetch responses, and used in-memory SQLite.

## Confirmed findings

### 1. P1 — Cloud restore/startup sync cannot import canonical BOOLEAN flags

Primary locations:
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/restore/route.ts:257`
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/startup-sync/route.ts:268`
- Same problem for auto-send and tiered-reward flags; e.g. restore route line 268.

`supabase-schema.sql:33,40,52,54` declares interrupted/enabled/batch_send/etc as BOOLEAN. The cloud→SQLite code passes these JavaScript booleans straight into better-sqlite3 `.run()`. That driver rejects booleans. The new RPC's flag conversion fixes the opposite direction only.

Reproduction: actual imported POST handlers with Supabase read functions returning one bulk_scan_state row `{scan_key:'scan', rows_json:'[]', interrupted:false, updated_at:1}` and real in-memory better-sqlite3. Restore returns `502 {"error":"Backup source read failed"}`. Startup-sync throws `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null`. Either true or false triggers it. Transactions roll back, so this is unavailable recovery/sync rather than partial local data corruption.

Smallest fix: normalize the known flag columns to numeric 0/1 at the cloud→SQLite boundary in BOTH routes. Add route tests with boolean remote fixtures; existing restore tests often derive remote rows from SQLite, preserving numeric flags and missing this failure. Existing production may have integer flags, but a new deployment from the checked-in schema has booleans and fails.

### 2. P1 — Full history export can silently omit an existing snapshot under insertion

Location: `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/saved-analyses/server.ts:15` (through line 33). Callers: export route line 44 and startup-sync route line 60.

`readSavedAnalysisRows` uses offset pages ordered newest-first and captures the total only on page one. An insertion before page two shifts the offset, duplicates a boundary row, and lets `rows.length >= total` declare success before reading the oldest row. The UI keyset pagination fix does not apply to this separate full-history reader.

Validated using the installed Supabase JS client with fake HTTP transport and actual imported function: start with 2,000 rows; insert one newer row before the second 1,000-row page. Output was `{error:null, returned:2000, unique:1999, missingOriginalLast:true, requests:2}`. A backup file therefore silently lacks a snapshot that existed when export began. Startup sync likewise misses that old row.

Smallest fix: reuse timestamp/id cursor pagination for the full reader, or use the existing full-row reader's per-page count validation and fail on detected changes (cursor is more robust). Add the two-page concurrent-insert regression; the current server tests cover stable pages/caps/errors only.

### 3. P1/P2 — Restore maintenance guard can throw from a running scanner's uncaught timer

Locations:
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/key-scanner/loop.ts:121`
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/local-restore-lock.ts:31`
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/lib/db.ts:761` (guardLocalWrites, actual error line verify if needed).

The new global maintenance guard blocks every SQLite write outside its AsyncLocalStorage context. It rejects active payment and backup runs but allows an active key scanner. Its 1.5-second checkpoint timer calls checkpoint without try/catch. While startup-sync or restore awaits cloud reads, that previously scheduled timer performs a write and throws LocalRestoreBusyError outside any promise handler. This can reach the process uncaught-exception handler; at minimum scanner checkpointing fails and counters stop persisting. No claim that a full running Next production process was killed was tested.

Validated actual scanner + actual lock + actual guarded SQLite in memory: mocked engine returns not-found; capture its scheduled checkpoint, begin an unresolved withLocalRestoreLock call, then invoke the timer in its original outside-maintenance context. Exact result: `UNCAUGHT TIMER PATH: LocalRestoreBusyError A local restore is in progress. Try again after it finishes.`

Smallest complete fix: scanner checkpoints should defer/retry when maintenance is active (retain dirty flag), and restore should either exclude active scanner work or explicitly coordinate it. Simply catching and forgetting the checkpoint loses persistence. Add a timer-during-maintenance regression. Tracer watcher catches its own write errors, so this finding specifically concerns scanner timer.

### 4. P2 — Cloud data lists silently stop at the API page cap

Primary location: `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/groups/route.ts:58` and `:65`.
Also read and confirmed same pattern in:
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/persons/route.ts:92`, `:103`, `:112`
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/creator-children/route.ts:34`
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/wallets-v2/route.ts:33`

These GETs promise complete arrays but issue one unpaged select. Once combined members exceed the API cap, later groups lose members even if the number of groups itself is small. Fingerprint and flow graph use these arrays as complete evidence, so this changes investigation output; wallet and person lists can disappear beyond the cap. Child IDs are also passed in one potentially long `.in()` URL.

Validated actual groups GET using installed SDK fake transport representing one group with 1,001 members and a 1,000-row cap: HTTP 200, exactly 1,000 returned members, only two requests, no incomplete marker or follow-up. This is incomplete display/calculation, not deletion from the database. Actual deployed cap was not queried.

Smallest fix: reuse `readAllUserRows` and `readAllChildRows` (already paginate and batch parent IDs) while preserving final UI ordering; filtered creator reads need a paged equivalent. Add >cap parent/child coverage. Official API reference used: https://supabase.com/docs/reference/javascript/select (current renderer did not expose default-cap sentence, so reproduction assumes 1,000 cap rather than claiming inspected deployment config).

### 5. P2 — Failed group/creator reads are cached as successful empty data

Locations:
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/groups/route.ts:58`–67
- `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/app/api/db/creator-children/route.ts:38`

The queries destructure data and discard error. A transient cloud error returns 200 [] (or groups with empty members). createDbCache accepts it, clears any prior error, and does not retry; ShortAddress labels/group membership and correlation facts disappear until a later refresh. This is distinct from pagination and applies even to one saved group.

Validated actual groups GET with installed SDK transport returning HTTP 503 `{message:'unavailable'}`: route returned `200 []`. No real cloud outage induced.

Smallest fix: check errors on both parent and child reads and return non-2xx, allowing existing stale-cache/retry behavior to work. Test parent failure and member failure independently.

### 6. P2 — New atomic restore SQL file is not a TAP test despite living in test-db discovery directory

Location: `/Users/_monitor/MyData/CODE/vibecode/1 in progress or to do/stellar-toolkit-dash/supabase/tests/database/atomic_restore.test.sql:1` and `:90`.

File explicitly targets `psql -v ON_ERROR_STOP=1`; it executes plain SELECT/DO ASSERT and has no TAP plan, ok assertions, or finish call. CI applies schema then runs `supabase test db` (.github/workflows workflow line 42), which uses pgTAP/TAP test output. Successful SQL statements do not constitute a valid TAP result, so this newly discovered file is incompatible with the configured runner even when its assertions pass under psql.

Evidence: entire 90-line file inspected; no plan/no_plan/ok/is/finish output. Official runner examples require plan/assertions/finish: https://supabase.com/docs/guides/local-development/testing/overview . Full CLI/container invocation not run by this subagent, so parent may report as confirmed format mismatch with CI outcome inferred unless independently reproduced.

Smallest fix: convert file to pgTAP (can wrap coarse SQL assertions with lives_ok), or move the psql-only script outside discovery and invoke it explicitly as a separate CI step. Preserve the alternate integer-flags run.

## Coverage / boundaries

Deep reads: local-backup-queue, local-restore-lock, db write guard and relevant schema/migrations, restore both directions, startup-sync, export, supabase-read-all, saved-analysis API/hook/server/summary, cache/auth lifecycle, atomic restore SQL/test, groups/persons/creator-children read paths and relevant mutations, wallets GET, scanner loop, tracer watcher. Read associated existing tests/ledger. No repeat of migration-unapplied or signing-safety-state-excluded issues already documented.

Sampled downstream logic: proceeds fetchers (asset and address paths), trade helper/tests, bulk scan persistence/callers, wallet balances fetching, person/group hooks, Fingerprint/FlowGraph data loading and fingerprint computation, settings backup handlers/module notes. No additional confirmed finding from these samples.

Not exhaustive line-by-line: large AssetLookupPanel, AddressInvestigatorTab, SavedAnalysesPanel rendering and all detail interactions, full intermediary matcher/fetchers, address generator worker, full settings/navigation, every CRUD mutation. Parent's global tests and other agent audits provide additional coverage; do not describe this subaudit as proving all those modules correct. No live Supabase/Horizon queries, external writes, production restore, signing, deploy, browser tests, or full CI/container run by this subagent. All five behavioral findings above have focused actual-code evidence; SQL runner mismatch is statically grounded with runtime CLI result pending.
