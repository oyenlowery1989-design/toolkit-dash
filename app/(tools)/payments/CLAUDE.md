## Payments
- Route: `app/(tools)/payments/page.tsx` — single file (~1800 lines), no separate components
- **4 tabs**: Send, Path, Claimable Balance, Fee Bump
- **Send tab**: multi-leg (asset + amount + destination per leg); wallet picker per leg; address book; Max button (XLM reserves 1 XLM); ShortAddress badge on valid destinations
- **Remove Trustline** (Send tab, non-native only): checkbox per leg; on check → auto-fills max balance; amber warning if amount < full balance; pre-flight fetches open offers via `server.offers().forAccount().limit(200).call()`, adds `manageSellOffer(amount=0)` cancel ops for any offer where asset is selling side; op order per leg: [cancel ops…] → payment → changeTrust(limit=0); `legCancelCountsRef` tracks cancel counts for correct op-index error mapping
- **Path tab**: strict-receive (exact dest, max send) and strict-send (exact send, min receive) toggle; calls `strictReceivePaths` / `strictSendPaths`; builds `pathPaymentStrictReceive` / `pathPaymentStrictSend`
- **Claimable Balance tab**: asset picker + amount + N claimants (all unconditional); `Operation.createClaimableBalance`
- **Fee Bump tab**: paste inner XDR → live parse (op count + fee); `TransactionBuilder.buildFeeBumpTransaction(pubKey, baseFee, innerTx, networkPassphrase)`; Memo/Fee cards hidden on this tab
- **Trustline recovery**: detects op_no_trust with correct legOpIndex mapping (accounts for cancel + changeTrust ops); prompts "Add trustline & retry"; shows live status during retry
- **Error messages**: `getErrorMessage` in `lib/stellar-helpers.ts` extracts `result_codes` from Horizon 400 → "tx: tx_failed | ops: op_underfunded"
