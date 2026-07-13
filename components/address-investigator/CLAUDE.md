## Address Investigator
- `AddressInvestigatorTab.tsx` — imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- **Address profile banner** shown above stat cards: `ShortAddress` (shows intermediary/creator/group badge automatically), home domain with globe icon + external link, Stellar.Expert link
- `homeDomain` fetched from `accountDetails.home_domain` (already loaded via `server.loadAccount`) — reset to `null` on each new search
- **"+ Group" button** on Top Senders and Top Recipients rows — opens inline Dialog with group selector (dropdown of all existing groups) + role selector, calls `upsertMember` directly; skips `NETWORK_FEES` pseudo-address
- Group dialog state: `groupDialog` (address + role), `dialogGroupId` (selected group id), `dialogRole`
- **Ancestry tracing** ("Who created?" in profile banner): uses shared `ChainDisplay` + `traceChainStep` from `components/shared/ChainDisplay.tsx`; state `addressChain`, abort via `realCreatorAbortRef` (pre-aborts on re-trace + unmount); resets on new search and deep-link; passes `assetCode=""`/`issuer=""` so it MUST pass `onAddToGroup` (wired to the existing group dialog above) — internal ChainDisplay dialog would create junk groups
- ChainDisplay/CreatorPeek `network` prop accepts full `Network` type; Stellar.Expert links render only for public/testnet (hidden on futurenet/local)
