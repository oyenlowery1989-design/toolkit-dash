# TRSY history coverage and seller review

Read-only public Horizon investigation on 2026-10-15. No transactions, user-data changes or publication.

Asset: `TRSY:GDAHP47TPZVR3CX45GAHLRJOOY6QV23HYSSVJ4NGR3P33ULLLJMST2KJ`.
Selected distributor: `GCDT…4AZI`.

## Coverage correction

Horizon's retained boundary was ledger 58654081, closed 2025-08-27T10:48:16Z.
The distributor's earliest retained payment is its successful creation on 2026-09-22T18:32:23Z:
[operation 277296974259396609](https://horizon.stellar.org/operations/277296974259396609).
Issuance of 1,000,000 TRSY followed in
[operation 277297034388606978](https://horizon.stellar.org/operations/277297034388606978).

The previous `!fromDate` condition always warned on all-history scans regardless of whether the selected accounts were created within retention. The scanner now defers that decision until pagination finishes. Every selected account must have successful, account-matched creation evidence as its earliest retained payment, inside the verified retention boundary. Otherwise the warning remains. Other accounting, evidence and pagination warnings are preserved.

Creation bounds are saved with operation/transaction evidence and displayed inside Analysis details. Coverage means the observed selected-account lifetimes, not all sellers, earlier merged incarnations, or an independently established asset-wide history. Existing saved snapshots retain their original coverage until rerun.

Reproducible public creation fixture: `tests/fixtures/proceeds/trsy-history-creation.json`. It tests coverage only, not historical financial totals.

## Other sellers

Both TRSY/XLM pair orientations were paginated in ascending order with limit 200, continuing through an empty page: nine pages each, the same 1,598 distinct trade IDs. Requests used `/trades` with `base_asset_type`, `base_asset_code`, `base_asset_issuer` and `counter_asset_type` (and the reverse orientation). Exact code and issuer were checked after retrieval; trade IDs were deduplicated across orientations.

There were 65 trade-side sellers including the selected distributor. The other 64 are not automatically attributable distributors. Their combined XLM counter-volume was 6,611.0079954 XLM; this is market turnover, not verified distributor receipts. Most had also bought on the same market.

Four larger/unfunded-by-market exceptions were investigated separately:

| Account | Evidence | Conclusion |
|---|---|---|
| GDGY…X3KD | Bought 1,622.0261310 TRSY on market and received 669.0037439 TRSY directly from the selected distributor, explaining the 2,291.0298749 sold. Sent 619.0037439 XLM to the distributor. [Sample own path sale](https://horizon.stellar.org/operations/278895015626215425) ends in XLM to itself. | Counterparty/reseller; common control unproven. |
| GBNR…4666 | Sent distributor 875.4297880 XLM, received 856.4297880 TRSY directly and 40.1214894 via GCQ3…3GOM. [Sample sale](https://horizon.stellar.org/operations/278122299469811713) fills another account's buy offer. | Repeated purchase/reward pattern; common control unproven. |
| GAQR…LUNJ | Sent distributor 20 XLM, received 20.25 TRSY directly plus another 1.5 TRSY transfer. [Sample sale](https://horizon.stellar.org/operations/278591374323249153) fills another account's buy offer. | Counterparty/reseller; common control unproven. |
| GCQ3…3GOM | Received 46.8214894 TRSY and forwarded 40.1214894 to GBNR…4666. Several receipts equal 5% of preceding purchases; a referral interpretation is an inference. [Sample sale](https://horizon.stellar.org/operations/278128488517500929) is its own TRSY→XLM offer. | Reward/transfer recipient; common control unproven. |

Issuer operations: ten records, complete. Selected-distributor operations: 3,611 records across 20 pages ending empty, complete. No TRSY claimable-balance distribution was found there; its seven claimable creations involved other assets.

Do not append these counterparties to the selected distributor accounts or sum their later resales into the distributor's proceeds. Incoming XLM payments to the distributor are a separate finding: they remain unclassified and must not be assumed to be asset sales solely from temporal proximity.

## Limits and checks

- The market query covers this classic TRSY/XLM pair. Other asset pairs, own conversions ending elsewhere, contract transfers and public-key incarnations before retention are not exhaustively reconstructed.
- Only sample operations for the four exceptions were correlated; raw pair totals are not validated proceeds totals.
- Issuer/distributor operation scans completed. GAQR/GCQ account-payment exploration was capped at 2,000 records; absence of other transfers is not established.
- No evidence was found that justifies automatically adding another distributor. This is not proof of independent ownership.
- Tests cover valid creation proof, unrelated/failed/unverified creation, pre-retention creation, multiple selected accounts, earlier retained activity and preservation of accounting warnings. A browser test checks the TRSY fixture's bounded coverage label and proof link.
