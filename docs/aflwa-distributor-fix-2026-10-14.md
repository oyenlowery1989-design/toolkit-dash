# AFLWA distributor inference fix — 2026-10-14

The automatic Asset Sales path now follows successful claimable-balance claims instead of stopping at the issuer's direct payment recipient. Saved-group distributors and explicit seller overrides retain their existing priority. No saved analysis/group was rewritten, no transaction was sent, and nothing was deployed.

## Confirmed ledger path

Asset: `AFLWA:GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ`.

| Evidence | Observed record |
|---|---|
| Issuer payment | Operation `263626385414348801`, 2026-02-24 16:38:09 UTC: 5,000,000 AFLWA to `GC67QDUVNVJBSNEI6FHPNGPDKUKZEZWNHVWT6E4L5XS5SYCKA2WAUTD6` |
| Claimable creation | Operation `263626389708668929`, 16:38:15 UTC: same asset/amount, created by the intermediary; both the intermediary and seller were eligible |
| Creation effect | Balance `000000003b347a425e7ebb55a6bf5857f2995c021e645f7354e5757a87122b6cd4bd993e`, matched by source account, asset and amount |
| Actual claim | Operation `263628554372382722`, 17:26:35 UTC: successful claim by `GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH` |
| Today's sales | Three DEX trades on 2026-10-14: 1,500 + 13,500 + 90 = **15,090 XLM**; this is a date-window result, not all-time proceeds |

Read-only source links: [issuer payments](https://horizon.stellar.org/accounts/GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ/payments?limit=200&order=asc), [creation effects](https://horizon.stellar.org/operations/263626389708668929/effects?limit=200&order=asc), [balance operations](https://horizon.stellar.org/claimable_balances/000000003b347a425e7ebb55a6bf5857f2995c021e645f7354e5757a87122b6cd4bd993e/operations?limit=200&order=asc), [seller trades](https://horizon.stellar.org/accounts/GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH/trades?limit=10&order=desc).

## Implementation and review

`inferDistribLite()` still starts with exact-asset outgoing issuer payments. It records the earliest payment cursor, reads subsequent account operations, obtains the balance ID from creation effects, verifies the matching successful creation, and credits only an eligible account with a successful matching claim. It reduces the intermediary's ranking by the forwarded amount and caps attributed credit at its issuer-funded amount. Eligible-only, failed, self, wrong-asset/source and clawback cases do not become new recipients.

Original issuer-payment pagination remains unlimited. New claim tracing is bounded to the top five direct candidates, three claim hops, twenty queued accounts and twenty pages per new endpoint. Incomplete proof, failed requests, exhausted limits and ambiguous already-visited convergence require explicit seller accounts instead of reporting a complete inference. Abort rejects partial work. Asset case and the proceeds calculator remain unchanged. Asset Sales supplies the optional URL logger; every inference request is logged to the browser console with the asset prefix.

The parent review checked creation-effect identity, claim/source identity, pagination compatibility, capped/residual attribution, and manual/saved selection priority. Additional mismatch and convergence regressions were added during review.

Official Horizon semantics: [claim operation identifies the actual claimant](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/operations/object/claim-claimable-balance), [related balance operations are successful references](https://developers.stellar.org/docs/data/apis/horizon/api-reference/cb-retrieve-related-operations).

## Verification

- **38 focused tests passed**, including captured public AFLWA records, pagination, mismatched proof, failed/unclaimed/self claims, abort, multi-hop and convergence limits.
- **636 tests across 107 files passed** in the full unit/API suite.
- TypeScript, full ESLint, production build and CRLF-aware diff checks passed.
- A separate read-only live test called the actual `inferDistribLite()` and `fetchAssetXlmProceeds()` against Horizon: the first candidate was the correct seller; the 2026-10-14 window returned **15,090 XLM and 3 DEX sales**. Log: `/tmp/aflwa-live-focused.log`. Temporary live test files remain outside Git in `.vercel`.

The separate bot's source is not present in this repository and was not reviewed. Existing saved groups/analyses that explicitly identify the intermediary are not automatically corrected; use the real seller override or correct the saved distributor. The earlier production release remains blocked until a complete database backup is available; `DATABASE_URL` is still absent locally.
