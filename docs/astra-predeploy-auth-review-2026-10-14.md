# Final narrow predeploy auth review

**Result: all three reported findings resolved; no remaining confirmed defect in the reviewed patch.** Recommend accepting the auth-isolation fixes subject to the parent's final integrated checks. Read-only review; no repository edits, browser/build startup, transactions, production calls, commit, push, or deployment.

## Resolutions

1. **Resolved P1 — stale failed submission restoring A's prompt in B.** `components/payments/usePaymentsController.ts:810` now checks the captured generation before operation-code processing. The late `op_no_trust` reproduction produces no state writes and no private wallet prompt. The existing submit wrapper also discards stale responses before journal acknowledgement.
2. **Resolved P2 — stale account/offer continuation leaving B in Signing.** Generation checks now follow initial account load (761), initial offers (772), each next offer page (776), signing (793), fallback account load/signing (886/888), and final result (896). Fee-bump signing/result awaits are covered at 740/750. The delayed-account reproduction now leaves status `idle`, with zero late state writes.
3. **Resolved P2 — trustline retry exposing A's wallet and reopening confirmation.** The callback captures owner generation and auth at 951–952; checks owner/auth/signer after account load, signing and submit; and ignores stale errors at 988. `clearPaymentDraft` now also clears `trustlineAdding`, so dropping an old continuation does not strand B in a busy trustline state. The same-owner successful callback still opens confirmation.

## Reset and refresh behavior

- Leaving an authenticated owner invokes the shared local draft reset. It clears manual secret and visibility, send legs, path inputs/results/request generation, claimable recipients/amount, fee-bump XDR/parsed fields, memo/fee, transaction result, trustline prompt/busy/status, address-book draft/target, and confirmation dialog.
- The auth reset never acknowledges or deletes the server journal. Explicit user reset acknowledges only the current completed record; pending submissions remain protected. A stale acknowledgement response cannot reset a later owner's draft.
- Same-owner token refresh leaves the auth effect dependencies unchanged and preserves drafts. Same-owner wallet changes retain the existing signer/balance reset behavior without invoking the new owner draft reset.
- A→B→A advances recovery generations, so prior A work cannot become valid merely because the owner ID matches again.
- `applySession` sets the new token before cache invalidation and sync. Cache generations reject prior-owner responses, and the sync event reloads mounted caches whose pre-auth request was invalidated. Saved-history sync also advances its continuation generation.

## Decisive independent verification

The following checks extract and transpile the actual current controller functions, then invoke them with controlled asynchronous dependencies; they do not duplicate the controller implementation or use network/browser state:

- `node /tmp/astra-predeploy-auth-repro.cjs` — PASS (exit 0): delayed A account lookup after switch/reset to B causes zero late state writes and leaves `idle`; delayed A `tx_failed/op_no_trust` causes zero writes and no prompt.
- `node /tmp/astra-predeploy-trustline-check.cjs` — PASS (exit 0): six cases (late success/failure at account load, signing, submission after owner switch) cause zero UI/toast/confirmation events. Same-owner successful submission control still calls confirmation.

Read the expanded 14-case `tests/e2e/payments-session.spec.ts`: it now includes delayed account, first offers and next-offer-page lookups; late failed payment with zero acknowledgements and no private prompt; trustline success/failure after owner switch; fee-bump signature; previous A→B/A→B→A signature, recovery and success-outcome coverage; normal signing and startup wallet restoration. The refresh test supplies a genuinely different access token and observes an authenticated wallet reload using it before checking preserved secret/XDR.

## Limits

Browser suite execution and global tests/build belong to the parent/worker; no claim of independently rerunning them here. No live-production verification, prior nine-fix re-audit, or unrelated module review. Source-level guards plus isolated reproductions support this narrow approval; final integration status remains the parent's evidence.

Parent relayed worker verification after this review: all 14 session browser cases PASS in 24.3 seconds; test server stopped. Worker also reproduced the relevant red baseline before the guards. This is worker evidence, separate from the independent actual-function harnesses above. Parent's global checks remain in progress at review handoff.
