## Bulk Payments
- `lib/bulk-payments/builder.ts` — `buildBatchTransaction(account, recipients, memo, keypair, networkPassphrase, feeMultiplier, amount, asset)` — amount + asset are optional (default: 0.0000001, XLM native)
- `lib/bulk-payments/runner.ts` — `RunBulkOptions` has `amount?` and `asset?` passed through to builder
- `lib/bulk-payments/builder.ts` — `estimateCost(recipientCount, batchSize, feeMultiplier, paymentXlmEach)` — 4th param is 0 for non-native assets
- **"From Group" tab**: loads member addresses from any saved asset group; deduplicated + exclude list applied
- **Min balance filter**: in Asset Holders tab — `minBalance` state filters holders below threshold before adding to recipients
- **Exclude list**: collapsible textarea below tabs; applied in `buildManualRecipients`, `handleFetchHolders`, and "From Group" load
- **Recipient preview**: in preview phase, shows first 8 addresses as ShortAddress badges + "+N more" count
- **Preview fix**: "Batches (N ops each)" uses dynamic `batchSize` not hardcoded 100
- **Cross-tab sync**: `useBulkRecipients` has `window focus` reload (same pattern as `useAssetGroups`)
