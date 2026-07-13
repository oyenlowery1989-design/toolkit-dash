## Ghost Payments
- Route: `app/(tools)/ghost-payments/page.tsx`
- Panel: `components/ghost-payments/GhostPaymentsPanel.tsx`
- **Mechanism**: Sends real XLM payments that SUCCEED — transactions are permanently visible on Horizon/Stellar.Expert with memo attached. `ghost: false` (standard submission). Amount is user-configurable; default 0.0000001 XLM (1 stroop, negligible value).
- **Why not failed txs**: `txTOO_LATE` (expired timebounds), `txBAD_SEQ`, `txBAD_AUTH` are all rejected by stellar-core BEFORE ledger inclusion — they never appear in Horizon history. Only operation-level failures (op_no_trust, op_no_destination) make it into the ledger, but those require complex setup.
- **Security purpose**: proves an address signed and submitted a transaction at a specific time, with a specific memo — useful for claim proofs, eligibility signals, on-chain messaging
- **Minimal cost**: 1 stroop per recipient = ~$0.000000001 each; fees are the real cost
- Reuses: `runBulkPayments` runner, `estimateCost`, `fetchAllHolders`, `useAssetGroups`, `useBulkRecipients`
- Do NOT add a ghost toggle to Bulk Payments — keep modules separate for clarity
