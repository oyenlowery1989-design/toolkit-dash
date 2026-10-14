# Astra audit remediation — 2026-10-14

All nine findings from [the full audit](astra-full-audit-2026-10-14.md) are repaired locally. Two GPT-6 Astra reviewers independently reviewed the money and data changes. Additional issues they reproduced were repaired and re-reviewed before completion. No commit, push, production migration, settings change, real transaction, or deployment was performed.

Follow-up: the two outstanding predeployment checks are now complete. See [predeployment readiness](predeploy-readiness-2026-10-14.md) for the full local Supabase CI execution, authenticated browser regressions, five additional fixes, and final integrated results.

## Changes and regression evidence

| # | Original failure | Final behavior and verification |
|---|---|---|
| 1 | Payments could pay twice after losing the response | A durable, owner-scoped journal is claimed before broadcast. Reload recovers it; an unresolved payment blocks another envelope. Identical requests return the recorded outcome. SQLite/API, Supabase transport/CAS, and browser reload regressions pass. |
| 2 | Reusing a Tiered Rewards approval repeated the distribution | A unique approval is atomically consumed and retains its outcome. Retries, including after preview expiry, return that outcome; a deliberate new run needs a fresh preview. Concurrent/repeated/partial-result tests pass. |
| 3 | Auto-Send paid more than approved after an incoming deposit | Manual execution uses the approved amounts under the account lock. A lower available balance fails safely; a deposit cannot increase the payment. Scheduled execution retains its existing calculation. Both balance-change regressions pass. |
| 4 | Cloud BOOLEAN values failed SQLite restore/startup sync | Both import boundaries normalize the known flags to numeric values. Actual-handler tests cover true/false values and rollback. |
| 5 | Concurrent inserts caused history export to omit old analyses | Complete-history reads use timestamp/ID cursors, including capped server pages. Concurrent insertion/deletion regression tests pass. |
| 6 | A scanner checkpoint could throw during restore maintenance | Active/dirty scanner work blocks maintenance; checkpoints defer or retain dirty state on failure. Timer and restore-exclusion tests pass. |
| 7 | Cloud lists silently stopped at the API row cap | Groups, members, persons, relationships, wallets, and creator children use complete paged reads with batched parent IDs and preserved display ordering. More-than-cap fixtures pass. |
| 8 | Failed cloud reads became successful empty lists | Parent and child failures return non-success responses, preserving existing client retry/stale-cache handling. Failure regressions pass. |
| 9 | Plain SQL assertions were discovered as TAP tests | Assertions live in `scripts/sql/atomic_restore.sql`; CI invokes them explicitly with `psql` for BOOLEAN and INTEGER flag schemas, separately from TAP discovery. Both variants passed on disposable PostgreSQL. |

## Issues caught by the independent review

- A never-included payment initially remained pending forever. Recovery now uses a pre-broadcast RPC ledger checkpoint and a single transaction lookup response to prove that retained ledger history covers the envelope through expiry. A generic missing transaction is insufficient proof. Imported fee-bump inner transactions are checked separately.
- Completed reward outcomes initially became inaccessible when preview authorization expired. Expiry now gates new execution; recorded results remain accessible only through the exact approval token and authenticated owner/config.
- Late Payments responses could affect a different login session. Generation checks now guard recovery, submission completion, and reset; authentication changes clear the old display state.
- A local approval exported under the cloud owner caused a false conflict when restored. Comparison now normalizes only the authorized local/current-owner identity while retaining all other immutable fields. Actual push→pull→push tests pass; foreign identities, changed outcomes, and changed receipt fields remain conflicts.

The safety journals are included in export/restore/startup sync, with ownership validation, immutable conflict handling, and explicit local/cloud identity mapping. Review details: [money](astra-money-fix-review-2026-10-14.md), [data](astra-data-fix-review-2026-10-14.md).

## Final verification

- Full unit/API suite: **106 files, 602 tests passed**.
- Full browser suite: **18 tests passed**, using isolated local data, simulated network responses, and Mainnet submission disabled. Final sequential confirmation: **18 passed in 29.5 seconds**, with no aborted-connection messages.
- TypeScript, full ESLint, production build, and diff whitespace check: passed.
- Disposable PostgreSQL 17: both atomic-restore assertion variants passed and rolled back, including ownership, permissions, mismatch rejection, late-failure rollback, and flag compatibility.
- Astra money review: 28 focused tests passed and no remaining confirmed blocker in its reviewed changes. Data review: 59 original focused tests passed; the final normalization re-review passed 25 route tests plus independent immutable-field assertions.

## Release conditions and limits

- Production is unchanged. Apply `supabase/migrations/20261014120906_atomic_local_restore.sql` at the eventual approved release before using local-to-cloud restore. Missing RPC fails closed; there is no unsafe fallback.
- No live blockchain transaction, production restore, or live-provider outage was tested. The follow-up ran the full database-security CI sequence against an isolated local Supabase stack, including RLS and both restore assertion variants. Cloud transport tests remain deterministic.
- RPC unavailability, insufficient retained history, old records without a checkpoint, or imported fee-bump envelopes without a provable history window intentionally keep recovery blocked. Investigate the outcome; do not delete the journal to force another payment.
- Local maintenance exclusion assumes one Node process. Full history reads are cursor-consistent, not a transactional point-in-time snapshot. Approval backup uses server-only filtered reads; very large shared approval histories may warrant indexed tenant storage later.
- The follow-up verifies cross-user browser state through the real installed Auth SDK with simulated transport: restored sessions, rotated tokens, A→B/A→B→A transitions, and late signing/recovery/payment/trustline responses. Live-provider login remains untested. Earlier parallel browser runs logged aborted connections while passing; see the latest readiness report for final run evidence and warnings.
- Earlier external/tooling limits remain documented in [the previous remediation ledger](audit-remediation-2026-10-14.md): Free-plan leaked-password protection and the development-only dependency advisory chain were not changed by these nine fixes.
- For the later deployment workflow, the Vercel CLI is currently unavailable; installing it with `npm i -g vercel` is recommended before using its deployment/environment/log commands. Nothing was installed globally during this work.
