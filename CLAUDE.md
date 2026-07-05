# Project Rules

## Module & Tab Stability
- Once a module or tab is functional and signed off by the user, **do not modify it** while working on another module or tab.
- If a new feature causes issues, isolate the problem to the new code only — never touch working code as a side effect.
- Each tab/module is treated as an independent unit. Fix bugs in the broken one without breaking the working ones.

## Development Approach
- Take it **step by step**. Build one phase at a time, verify it works, then move to the next.
- Do not add Phase 2 logic until Phase 1 is confirmed working by the user.
- Do not add options/controls to the UI for features not yet implemented.

## Asset Code Case Sensitivity
- Stellar asset codes are **case-sensitive on the ledger** — `WhipSim` ≠ `WHIPSIM`.
- **Never force-uppercase asset codes** from URL params or user input — preserve original case.
- All asset code comparisons in fetchers must use `.toUpperCase()` on both sides for case-insensitive matching.
- **Never force-uppercase in display** — always render the code exactly as stored/entered (e.g. `wUSDC`, not `WUSDC`).

## Stellar / Horizon API Rules
- **ALWAYS** use `/accounts/{address}/operations` — NEVER `/operations?account={address}`.
- **ALWAYS** use `/accounts/{address}/payments` — NEVER `/payments?account={address}`.
  - The `?account=X` variant returns ops/payments from ALL transactions X was involved in (any role).
  - The `/accounts/{address}/` path returns only records where the address was the actor.
- `type=create_account` can be passed as a URL param for server-side filtering on operations endpoints.
- Always verify `op.funder === intermediary` explicitly — do not use `op.account !== intermediary` as a proxy.
- Paging tokens are globally sequential across accounts — a token from creator's payments can be used as cursor on intermediary's operations.
- Use `parseFloat()` not `parseInt()` for fractional day values (e.g. "0.042" for 1 hour).
- Always log the full URL being fetched (`onLog(\`  GET \${url}\`)`) so bugs are visible in the activity log.

## Address Display
- Always display Stellar addresses as `GABC…WXYZ` (4 chars + ellipsis + 4 chars).
- Use the `shortAddr()` helper in fetchers.ts or the `ShortAddress` component in UI.

## Log Panels
- Log panels must support manual scrolling — auto-scroll only when user is already at the bottom.
- Use `userScrolledUp` ref pattern with `onScroll` handler to detect manual scroll.

## Fetcher Pattern
- Add `onLog` callback to all fetchers for activity logging.
- Add `onResult` callback for streaming results live as they are found.
- Never clear results when user presses Stop — accumulate in state with `prev => [...prev, result]`.
- When a fetcher has multiple phases (e.g. Phase 1 collect, Phase 2 enrich), call `onResult` in Phase 1 immediately, then call it again in Phase 2 with the enriched entry. The UI merges by key (`account` field) so rows update in-place.

## Periodic Code Review
- After completing any feature or bug fix, re-read the changed files and adjacent code.
- Proactively look for: dead code, type mismatches, UI states that can never render, duplicated components, inconsistent address display, callbacks with wrong signatures.
- Propose improvements to the user even if not asked — list them briefly after completing work.
- Track unfinished features (e.g. `detectClusters` in matcher.ts) and surface them in reviews.

## Standard Module Layout
- `AppLayout` already wraps all pages in `container mx-auto p-4 md:p-8 max-w-7xl` — **do not add another `max-w-*` or extra padding in `page.tsx`**.
- Every new page must follow this shell:
  ```tsx
  export default function MyPage() {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Title</h1>
          <p className="text-muted-foreground mt-2">Description.</p>
        </div>
        <Suspense fallback={<LoadingSpinner />}>
          <MyPanel />
        </Suspense>
      </div>
    );
  }
  ```
- Always use shared UI components: `<Input>`, `<Button>`, `<Select>` from `@/components/ui`; `<WalletSelect>` for wallet pickers; `<ShortAddress>` for any Stellar address display.
- Never use raw HTML `<input>`, `<button>`, `<select>` in module UI.

## Module Inventory
| Module | Status |
|---|---|
| `address-investigator` | Working — recently updated with home domain, group buttons |
| `asset-lookup` | Working, signed off |
| `search-history` | Working, signed off |
| `bulk-asset-sales` | Working — recently updated with context-aware group buttons |
| `asset-sales` (proceeds) | Working — recently updated with auto-infer distrib, context-aware group buttons |
| `intermediary-tracer` | Mostly complete — see notes below |
| `address-generator` | Working — Web Worker vanity address generator |
| `bulk-payments` | Working — secret key field replaced by active wallet indicator when wallet connected |
| `ghost-payments` | Working — secret key field replaced by active wallet indicator when wallet connected |
| `asset-creator` | Working — 4-step wizard: accounts, asset config, preflight, execution; auto-saves to Asset Groups |
| `asset-manager` | Working — shared asset input panel + Asset Flags tab + Holders tab (trustlines + sell offers combined) |
| `account-funder` | Working — bulk keypair generator + createAccount funder; Direct/Sponsored/Close tabs; save to Asset Group |
| `trustline-manager` | Working — Single tab (add/remove/drain) + Bulk tab (N assets × M accounts matrix); auto-delete toggle |
| `soroban` | Working — SAC deploy wizard for wrapping existing classic assets |
| `dex-orderbook` | Working — bid/ask tables, stats cards, depth chart (recharts) |
| `wallet-manager` | Working — folders + wallets + connect/disconnect; header switcher added |
| `my-wallet` | Working — connected wallet overview: XLM/Available/Reserved/30d-net-flow cards, reserve breakdown popup, home domain (editable inline), thresholds+sequence, account flags (AUTH_REQUIRED etc), inflation dest, signers, claimable balances (claim), assets+trustlines (DEX/Send/Remove icons), open offers, payment history (in/out), recent txs, merge account (danger zone), quick actions — all sections collapsible via `Section` component |
| `payments` | Working — Send (multi-leg, Max, remove-trustline + offer cancel), Path (strict-receive + strict-send), Claimable Balance, Fee Bump; ShortAddress on all destinations |
| `address-book` | Working, signed off |
| `saved-analyses` | Working, signed off |
| `settings` | Working — network/Horizon URL + theme config |
| `transactions` | Working — transaction explorer/viewer |
| `auto-send-groups` | Working — scheduled XLM distribution groups; see full section below |
| `tiered-rewards` | Working — tiered per-holder reward distribution; multi-asset tiers; scheduled or manual; batch/separate mode; JSON import; preview modal; run history |
| `wallet-balances` | Working — live XLM balance across all saved wallets; filter by folder or asset group; sort by balance; inline add wallet; copy/connect/investigate/send actions |

## DB-Backed Hooks (SQLite)
- All critical user data hooks use `createDbCache<T>()` from `lib/db-client.ts`.
- Pattern: module-level `_cache`, `useEffect` subscribes + loads, optimistic writes via `dbPost/dbPatch/dbDelete`.
- API routes live at `/api/db/{table}`. DB file: `stellar-toolkit.db` in project root.
- **Do NOT use localStorage for new persistent data** — add a table to `lib/db.ts` and an API route.
- Intentional localStorage: `use-search-history` factory, `address-generator` page (ephemeral keys, never persisted to DB by design), `use-active-wallet` (mirrors DB for instant restore on mount).

## Snapshot Helpers
- `getSavedSearchesSnapshot()`, `getBulkRunSnapshot()`, `getSavedAnalysesSnapshot()` return `[]` until `load()` completes.
- Use snapshots only for fire-and-forget reads after page load; use the reactive hook for rendering.

## Address Resolution (ShortAddress)
- `lib/address-resolver.ts` — pure `resolveAddress(address, bookEntries, intermediaries, creators, groups)` function
- `ShortAddress` subscribes to all 4 caches: Address Book, Known Intermediaries, Known Creators, Asset Groups
- **Priority (highest → lowest): Known Intermediary > Known Creator > Asset Group > Address Book > raw**
  - Groups beat Address Book because they carry structured role context (ISSUER, BANK, DISTRIB, etc.)
  - Address Book is the fallback for personal notes on unclassified addresses
- Badges: `INTERMEDIARY` (yellow), `CREATOR` (green), role name e.g. `ISSUER`/`DISTRIB`/`BANK` (purple)
- Group member badge always shows the **role** (e.g. `ISSUER`), falls back to group name as display label when no member label is set
- Quick-add "+" button only shown for completely unrecognised addresses (source === "none")
- Address Book Add form does live conflict check: warns with yellow banner if address already exists in a group, intermediary list, or creator list — includes "View group →" link

## Real Creator / Ancestry Tracing (Asset Lookup + Address Investigator)
- Shared UI + logic live in `components/shared/ChainDisplay.tsx` — exports `ChainNode`, `ChainState`, `fetchHomeDomain`, `traceChainStep`, `CreatorPeek`, `ChainDisplay`
- "Trace ancestry →" button appears when `issuerInfo.createdBy` or `distribCreators[addr]` is a known intermediary
- **`traceChainStep(targetAddress, signal, setChain, horizonUrl, knownIntermediaries)`** — single step (NOT recursive); user manually controls depth via "Continue →" button
  - Single shared implementation exported from `components/shared/ChainDisplay.tsx`; used by BOTH AssetLookupPanel (4 call sites) and AddressInvestigatorTab (2 call sites) — no inline copies remain
- Each click does exactly ONE hop; state accumulates via `chain: [...prev.chain, newNode]`
- **`ChainNode` fields:** `creator`, `creatorType`, `realOwner?`, `confidence?`, `noNative?`, `homeDomain?`, `realOwnerHomeDomain?`
  - `homeDomain` / `realOwnerHomeDomain` fetched via `fetchHomeDomain(horizonUrl, address, signal)` at the end of each step
- **`ChainNode` has 3 types:**
  - `"intermediary"` — created via known intermediary; payment-scanned to find `realOwner` + `confidence`
  - `"direct"` — creator is NOT an intermediary; shown as "Creator N"
  - `"pruned"` — `fetchAccountCreation` returned nothing AND `fetchAccountCreator` (SDK fallback) also failed; shows "view on Stellar.Expert ↗" link
- Falls back to `fetchAccountCreator(server, address, signal)` via SDK if `fetchAccountCreation` returns null (old accounts with pruned history)
- **"Continue →"** button appears on: `direct` nodes, `intermediary` nodes with `realOwner`, AND `intermediary` nodes with no realOwner (shows "Continue from intermediary →", continues from `node.creator`)
- Results stream live — each node pushed to state as found; `searching` field shows current address being traced
- **`ChainDisplay`** (shared component) needs props: `chain`, `network`, `assetCode`, `issuer`, `horizonUrl`, `knownIntermediaryAddrs`, `onContinue`; optional `onAddToGroup(address, defaultRole)`
  - Uses inline Dialog with label + role selector for "+ Group" action — auto-creates/targets group by `assetCode+issuer+network`
  - **`onAddToGroup` provided → "+ Group" calls it instead of the internal dialog.** REQUIRED in no-asset contexts (Address Investigator passes `assetCode=""`/`issuer=""`) — internal dialog there would create a junk `" Asset"` group with empty metadata
  - `getGroupInfo(address)` checks ALL groups (not just current asset's group) — O(groups × members) per render
  - Shows "✓ in group" link if address already in any group, "+ Group" button otherwise
  - Tracks `savedAddrs` Set for addresses saved this session (before cache reloads)
- **`CreatorPeek`** — shown on the final `realOwner` node; "Who created?" button fetches `fetchAccountCreation` + marks creator as INTERMEDIARY if known; pass real `knownIntermediaries` Set (not empty `new Set()`)
- `issuerChain` / `distribChain` reset on every new search via `setIssuerChain({ status: "idle", chain: [] })`
- Both share `realCreatorAbortRef`
- `fetchAccountCreation` + `findFunderCandidates` + `fetchAccountCreator` all statically imported
- **Pruned accounts**: Horizon only keeps a rolling history window; old accounts' `create_account` op is gone. Shows "view on Stellar.Expert ↗" link (`https://stellar.expert/explorer/{network}/account/{address}`) for full history

## Asset Groups — URL Params (groups page)
Full `autoCreate` URL param spec:
- `autoCreate=1` — trigger auto-create/add flow on mount (requires `isLoaded` guard + `useRef` prefill sentinel)
- `name` — group name; if assetCode present, group name becomes `${assetCode.toUpperCase()} Asset`
- `assetCode`, `issuer`, `network` — group metadata; used for duplicate detection (by assetCode+issuer+network OR name)
- `distrib` — added as `distributor` role member
- `issuerHomeDomain`, `distribHomeDomain` — separate home domains for issuer and distrib members
- `addAddress`, `addRole`, `addLabel`, `addHomeDomain` — add a single extra member to new OR existing group
- If group already exists (by assetCode+issuer+network): adds `addAddress` if not already a member, then navigates — **no duplicate group created**
- `open=GROUP_ID` — opens that group expanded on load (no autoCreate needed)

## Asset Groups
- Tables: `asset_groups`, `asset_group_members` (FK cascade on delete)
- 9 roles: `issuer`, `distributor`, `creator`, `intermediary`, `bank`, `withdrawal`, `destination`, `service`, `other`
- Types + role constants: `lib/asset-groups/types.ts` (`GroupMemberRole`, `ROLE_LABELS`, `ROLE_COLORS`)
- Hook: `hooks/use-asset-groups.ts` — uses DB cache pattern; delete uses custom fetch (not `dbDelete`) because body needs `type` discriminator
- API: `/api/db/groups` — POST/PATCH/DELETE body must include `type: "group"` or `type: "member"`
- Page: `app/(data)/groups/page.tsx` — handles `?autoCreate=1&name=...&assetCode=...&issuer=...&distrib=...&issuerHomeDomain=...&distribHomeDomain=...&network=...` to auto-create group on mount
- "Save to Group" always opens in a **new tab** (`target="_blank"` or `window.open(..., "_blank")`) — never navigate away from source page
- **Context-aware group buttons** — always check `useAssetGroups()` before rendering:
  - If group already exists for that asset (by `assetCode+issuer+network`): show green **"Open Group →"** linking to `/groups?open={group.id}`
  - If not yet: show purple **"Save to Group"** with `autoCreate=1` URL params
  - If a destination address is already a member: show green **"✓ in group"**; otherwise show **"+ Bank"**
- "Save to Group" in Bulk Asset Sales: purple pill-style per row, switches to green "Open Group" if group exists
- "Save to Group" in Asset Sales (single): same pattern in toolbar next to Save Analysis
- **Top Destinations table** (both Bulk Asset Sales and Asset XLM Proceeds): Layers icon per row — green if already in group, purple "+ Bank" otherwise
- Auto-infer distrib: Asset Sales `handleRun` calls `inferDistribLite` automatically if `accountsText` is empty, populates the field and proceeds without extra click
- Home domain: pass **separate** `issuerHomeDomain` and `distribHomeDomain` params — never share one domain for both
- Cross-group correlation: shared intermediary/bank/withdrawal address across multiple groups = same operator fingerprint

## Bulk Asset Sales
- `BulkAssetSalesPanel.tsx` — `AssetRow` has `homeDomain?` field fetched from `/accounts/{issuer}` after distrib is inferred
- Summary row shows: asset code + home domain, issuer (ISS label) + distrib (DST label), XLM proceeds, asset sold, status, Save to Group button
- Watchdog `useEffect`: `if (running && rows.length > 0 && pendingCount === 0)` → abort + `setRunning(false)` to prevent infinite spinner
- Progress text: `pendingCount === 0 ? "Finalising…" : Scanning ${Math.min(done+error+1, total)} of ${total}…`
- Lobstr URLs (`https://lobstr.co/trade/CODE:ISSUER`) are accepted directly in the textarea — parser extracts code + issuer

## Address Investigator
- `AddressInvestigatorTab.tsx` — imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- **Address profile banner** shown above stat cards: `ShortAddress` (shows intermediary/creator/group badge automatically), home domain with globe icon + external link, Stellar.Expert link
- `homeDomain` fetched from `accountDetails.home_domain` (already loaded via `server.loadAccount`) — reset to `null` on each new search
- **"+ Group" button** on Top Senders and Top Recipients rows — opens inline Dialog with group selector (dropdown of all existing groups) + role selector, calls `upsertMember` directly; skips `NETWORK_FEES` pseudo-address
- Group dialog state: `groupDialog` (address + role), `dialogGroupId` (selected group id), `dialogRole`
- **Ancestry tracing** ("Who created?" in profile banner): uses shared `ChainDisplay` + `traceChainStep` from `components/shared/ChainDisplay.tsx`; state `addressChain`, abort via `realCreatorAbortRef` (pre-aborts on re-trace + unmount); resets on new search and deep-link; passes `assetCode=""`/`issuer=""` so it MUST pass `onAddToGroup` (wired to the existing group dialog above) — internal ChainDisplay dialog would create junk groups
- Known cosmetic nit: ChainDisplay `network` prop coerces futurenet→"testnet" (label/links only; data fetch uses correct horizonUrl)

## Address Book Conflict Warning
- `AddressBookPanel.tsx` imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- `EntryForm` computes `conflict` inline (not a hook) — checks the typed address against all three sources live
- Warning shown only on Add form (not edit). Shows entity name, type, and "View group →" link for group conflicts
- Do NOT auto-add group members to address book — group membership already provides label + badge everywhere via ShortAddress

## Saved Analyses Module
- Hook: `hooks/use-saved-analyses.ts` — DB-backed, stores `SavedAnalysis` (id, name, assetCode, issuer, distribAddresses, network, timestamp, result, notes?, tags?)
- `result` is the full `AssetProceedsResult` — all XLM proceeds/sold/outgoing/onHand + topDestinations
- **Auto-save**: `BulkAssetSalesPanel` calls `saveAnalysis()` automatically on each row completion (no manual button needed); Asset Sales single still has manual "Save Analysis" button
- `SavedAnalysesPanel` has two views toggled by header buttons:
  - **Table view** (default): sortable by any column (asset, XLM proceeds, asset sold, outgoing, on hand, saved date); click header to sort asc/desc
  - **Cards view**: expandable cards with tags, notes, re-run button, top destinations table
- **Aggregate stats bar**: total XLM proceeds, total outgoing, unique assets, unique issuers, top earner — shown above the list
- **Cross-Asset Destinations** section: aggregates `topDestinations` across ALL filtered analyses, highlights addresses that appear in multiple assets with a yellow "shared" badge — reveals shared banks/exchanges across projects; collapsed by default
- DB endpoint: `/api/db/saved-analyses`; max 50 entries (oldest dropped on insert)
- `window focus` sync not added to saved-analyses (only asset-groups has it) — may be needed if cross-tab save is required

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

## Ghost Payments
- Route: `app/(tools)/ghost-payments/page.tsx`
- Panel: `components/ghost-payments/GhostPaymentsPanel.tsx`
- **Mechanism**: Sends real XLM payments that SUCCEED — transactions are permanently visible on Horizon/Stellar.Expert with memo attached. `ghost: false` (standard submission). Amount is user-configurable; default 0.0000001 XLM (1 stroop, negligible value).
- **Why not failed txs**: `txTOO_LATE` (expired timebounds), `txBAD_SEQ`, `txBAD_AUTH` are all rejected by stellar-core BEFORE ledger inclusion — they never appear in Horizon history. Only operation-level failures (op_no_trust, op_no_destination) make it into the ledger, but those require complex setup.
- **Security purpose**: proves an address signed and submitted a transaction at a specific time, with a specific memo — useful for claim proofs, eligibility signals, on-chain messaging
- **Minimal cost**: 1 stroop per recipient = ~$0.000000001 each; fees are the real cost
- Reuses: `runBulkPayments` runner, `estimateCost`, `fetchAllHolders`, `useAssetGroups`, `useBulkRecipients`
- Do NOT add a ghost toggle to Bulk Payments — keep modules separate for clarity

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

## Asset Creator
- Route: `app/(tools)/asset-creator/page.tsx`
- Panel: `components/asset-creator/AssetCreatorPanel.tsx`
- Steps: `components/asset-creator/steps/Step1Accounts.tsx`, `Step2AssetConfig.tsx`, `Step3Preflight.tsx`, `Step4Result.tsx`
- Lib: `lib/asset-creator/types.ts`, `preflight.ts`, `builder.ts`, `runner.ts`, `toml.ts`
- **4-step wizard**: Accounts → Asset Config → Preflight → Execute
- **Network**: always read from global `useSettings()` — never has its own network selector
- **Keypair fields**: enter secret key only — public key is derived automatically via `Keypair.fromSecret()`
- **Wallet picker**: "Use wallet" dropdown on each keypair field loads all wallets from `useWalletsV2()`; picks secret + derives public
- **Funding source** (mainnet/futurenet only): shown only when `network !== "testnet"`; uses `activeWallet` if connected, otherwise manual secret key field. On testnet: Friendbot funds accounts automatically.
- **Preflight checks**: account existence + balance (≥1.5 XLM) for issuer + distrib, asset already-issued warning, fee estimate — all run on mount
- **Execution**: `runAssetCreation` in `lib/asset-creator/runner.ts` — testnet uses Friendbot, mainnet submits `fund-accounts` → `set-home-domain` → `trustline` → `issuance` transactions sequentially
- **Auto-save**: on full success, creates Asset Group with `issuer` + `distributor` roles; shows "Open Group →" button
- **`StandardStrategy`** in `builder.ts` implements `CreationStrategy` interface — pluggable for future multi-sig or custom strategies
- **Execution progress**: live per-step checklist shown during execution (onStep wired, not a no-op)
- **fund-accounts smart**: checks each account individually before creating — handles pre-existing accounts gracefully
- **Mainnet safety**: funding wallet balance checked in preflight; missing funding key blocks execute with clear message

## Asset Manager
- Route: `app/(tools)/asset-manager/page.tsx`
- Panel: `components/asset-manager/AssetManagerPanel.tsx`
- Tabs: `FlagsTab.tsx`, `HoldersTab.tsx`
- Lib: `lib/asset-manager/index.ts`
- **Shared state**: `assetCode`, `issuer`, `secretKey` are owned by `AssetManagerPanel` and passed as props to all tabs — entered once, persisted while switching tabs, cleared by the X button (shown when `isReady`)
- **`isReady`** = `assetCode.trim().length > 0 && StrKey.isValidEd25519PublicKey(issuer.trim())` — tabs only render when ready
- **Group picker**: loads `assetCode + issuer` from any saved asset group; shown when `groups.length > 0`
- **Wallet**: shows green wallet indicator when `activeWallet` is set; `secretKey = activeWallet?.secretKey ?? manualSecretKey.trim()`
- **FlagsTab** — `{ issuer, secretKey }` props; Load/Reload flags, toggle AUTH_REQUIRED / AUTH_REVOCABLE / AUTH_CLAWBACK_ENABLED / AUTH_IMMUTABLE with single TX each
- **HoldersTab** — `{ assetCode, issuer, secretKey }` props; runs `fetchTrustlineHolders` + `fetchSellOffers` concurrently via `Promise.allSettled`; merges into unified `HolderRow`; filter pills (All / Sellers / Frozen); action buttons (🔓 Unfreeze / – Restrict / 🔒 Freeze); amber highlight on rows with sell offers; Export CSV
- `TrustlineAction`: `"authorize" | "freeze" | "maintain_only"` — maps to `set_trust_line_flags` flags
- `AUTH_FLAGS`: REQUIRED=1, REVOCABLE=2, IMMUTABLE=4, CLAWBACK_ENABLED=8

## Account Funder
- Route: `app/(tools)/account-funder/page.tsx`
- Panel: `components/account-funder/AccountFunderPanel.tsx`
- **Purpose**: Generate N new Stellar keypairs and fund them in one step from a parent account
- **Parent**: existing saved wallet (picker) OR freshly generated keypair
- **Children**: N new accounts created by the parent via `createAccount`
- **Three creation modes**: Direct (parent pays reserve), Sponsored (begin/end sponsoring), Close (close sponsorship)
- **Network**: from `useSettings()` — `resolveNetworkPassphrase(settings.network)` (NOT the whole `settings` object)
- Save parent + all children to one Asset Group on completion
- Keys generated client-side in browser

## Trustline Manager
- Route: `app/(tools)/trustline-manager/page.tsx`
- Panel: `components/trustline-manager/TrustlineManagerPanel.tsx`
- Tabs: `SingleTrustlineTab.tsx`, `BulkTrustlineTab.tsx`
- Lib: `lib/trustline-manager/index.ts`
- **Single tab**: add or remove one trustline at a time; drain-before-remove (sends balance to destination then removes); auto-populate drain destination from active wallet
- **Bulk tab**: N assets × M accounts — progress grid; auto-delete toggle; drain option with destination; static warning note about offers
- **Offer detection**: in remove mode, `fetchAccountOffersForAsset` checks both selling AND buying sides (debounced 900ms) — both block trustline removal with `op_line_full`
- **Offer cancel**: amber panel shows offer table (ID, selling, buying, amount, price); manual "Cancel N offers" button + auto-cancel in `handleSubmit`
- `cancelOffersBatch`: uses `manageSellOffer amount=0` with correct asset fields from `AccountOffer._rawSelling/_rawBuying`; batches 100 ops/tx
- `drainAndRemoveTrustline`: custom assets send balance + `change_trust limit=0` in one tx; XLM uses `accountMerge`
- `MAX_TRUST_LIMIT = "922337203685.4775807"`
- **`AccountOffer` type**: `{ id, sellingLabel, buyingLabel, amount, price, _rawSelling, _rawBuying }` — raw fields: `{ type, code?, issuer? }` for reconstructing Asset objects

## Soroban Contracts
- Route: `app/(tools)/soroban/page.tsx`
- Panel: `components/soroban/SorobanPanel.tsx`
- Lib: `lib/soroban/sac.ts`
- **Purpose**: Wrap an existing classic Stellar asset with a Stellar Asset Contract (SAC) — does NOT create a new asset
- `computeSacAddress(assetCode, issuer, network)` — deterministic, no network call; uses `Asset.contractId(networkPassphrase)`
- `checkSacDeployed(contractId, network, signal?)` — queries Soroban RPC `getLedgerEntries` for contract instance key
- `deploySac(options)` — `invokeHostFunction` tx with `HostFunctionTypeCreateContract` + `contractIdPreimageFromAsset`; simulate → assemble → sign → submit → poll 30×2s
- `SOROBAN_RPC_URLS` constants for public/testnet/futurenet; `resolveRpcUrl(network, localRpcUrl?)` helper
- Contract ID shown instantly (deterministic); deploy button requires wallet or secret key
- SAC vs classic: SAC has Soroban token interface (`balance`, `transfer`, `approve`) — but most wallets (Lobstr, Solar) still show the underlying classic asset balance, not the SAC balance; users transacting via DEX/Horizon see classic asset as usual

## Intermediary Tracer — Tab Status
| Tab | Status |
|---|---|
| Trace Single Account | Working, signed off — DO NOT TOUCH |
| Scan Intermediary | Working, Phase 1+2 streaming, cluster detection shown |
| Known Intermediaries | Working, signed off — DO NOT TOUCH |
| Known Creators | Working, signed off — DO NOT TOUCH |
| Creator's Accounts | Built, needs user verification |

## Wallet Manager
- Hooks: `hooks/use-wallet-folders.ts`, `hooks/use-wallets-v2.ts`, `hooks/use-active-wallet.ts`
- Panel: `components/wallet-manager/WalletManagerPanel.tsx`
- Wallets organised in folders (2-panel layout: folder list left, wallet list right)
- `WalletEntry`: `{ id, folderId, name, publicKey, secretKey, position }` — stored in SQLite DB via `/api/db/wallets-v2`
- `WalletFolder`: stored via `/api/db/wallet-folders`
- Active wallet: `useActiveWallet()` — module-level singleton, persisted in DB via `/api/db/app-state` key `active_wallet_id`; also mirrored to localStorage for instant restore on mount
- **Cross-tab sync**: `useActiveWallet` listens to `storage` events so connect/disconnect in one tab reflects in all other open tabs
- **Header wallet button**: always visible in header — dashed "Connect Wallet" when disconnected, green pill with name+address when connected; dropdown lists all wallets for switching + disconnect action
- **Bulk Payments + Ghost Payments**: when `activeWallet` is set, secret key input is replaced by a green wallet indicator; `effectiveSecretKey = activeWallet?.secretKey ?? secretKey`
- **Folder delete cascade**: `deleteFolder` optimistically purges wallets from cache via `purgeWalletsByFolder()` from `use-wallets-v2`; API route also manually deletes wallets before folder (SQLite FK constraint can't be added via ALTER TABLE)
- **Wallet data IS in SQLite DB** (not localStorage) — this is a local single-user tool; secret keys stored server-side in `stellar-toolkit.db`; do not add cloud sync or multi-user access without security review
- Old `/api/db/wallets` route removed — only `wallets-v2` is active; `hooks/use-wallets.ts` is a re-export shim (still referenced by `app/page.tsx`)
- `shortAddr()` canonical location: `lib/format.ts` — import from there, do not define inline in components

## My Wallet Page
- Route: `app/(tools)/my-wallet/page.tsx` — all UI in one file, no separate components
- **`Section` component** (defined inline in the file): collapsible card wrapper with chevron toggle, badge, and optional `right` slot (for external links, etc.)
- **Always use `Section` for any new card-style panel** in this page — never use raw `<div className="rounded-xl border...">` with a manual header
- `defaultOpen` prop: `true` for primary data (XLM, assets), `false` for secondary (offers, txs, quick actions, signers)
- Claimable balances: can only be **claimed**, not deleted — recipients have no cancel action on Stellar protocol level

## Shared Utilities
- `lib/format.ts` — `formatXlm()`, `parseAddresses()`, `shortAddr()` (4+4 addr format)
- `lib/db-client.ts` — `createDbCache<T>()`, `dbPost/dbPatch/dbDelete` (all log errors to console now, not silent swallow)
- `lib/address-resolver.ts` — `resolveAddress()` pure function

## Auto-Send Groups
- Route: `app/(tools)/auto-send-groups/page.tsx`
- Panel: `components/auto-send-groups/AutoSendGroupsPanel.tsx` (~1500+ lines, all UI in one file)
- Lib: `lib/auto-send/types.ts`, `runner.ts`, `scheduler.ts`
- Hook: `hooks/use-auto-send-groups.ts` — DB-backed cache; exposes `isLoaded` for loading gate
- API routes:
  - `/api/db/auto-send-groups` — CRUD for groups + destinations
  - `/api/auto-send/run` — manual run, dry-run (preview), test run, refresh-scheduler
  - `/api/auto-send/history` — last 200 run log entries; `?totals=1` returns per-destination lifetime aggregates
  - `/api/auto-send/balance` — live XLM balance for a group's wallet via Horizon
  - `/api/auto-send/stats` — panel-level aggregate stats
  - `/api/auto-send/scheduler-status` — returns `{ serverless: boolean }` to warn when on Vercel

### Persistence — Dual-Mode (Supabase + SQLite)
- **Deployed (Vercel)**: `isSupabaseOnly()` returns true → all routes use Supabase. Vercel serverless has ephemeral SQLite (read-only bundle), so Supabase is mandatory for persistence.
- **Local dev**: SQLite only (`stellar-toolkit.db`); Supabase not required.
- All 4 auto-send API routes handle both modes: `/api/db/auto-send-groups`, `/api/auto-send/run`, `/api/auto-send/history`, `/api/auto-send/stats`
- Supabase tables have `user_id` column for multi-user isolation; SQLite tables do not (single-user local tool)
- Destination upsert pattern: always SELECT existing id by `(group_id, destination)` first, then upsert with that id — avoids UNIQUE constraint collision when re-adding same address with new UUID
- `isSupabaseOnly()` is true when `DB_PROVIDER=supabase` OR `VERCEL` env is set + Supabase is configured

### DB Tables
- `auto_send_groups`: `id, name, network, secret_key, interval_minutes, enabled, batch_send, batch_memo, min_reserve, min_sender_threshold, preview_only, last_failure_at, created_at`
- `auto_send_destinations`: `id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position`
- `auto_send_run_log`: `id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash`
- Supabase versions of all 3 tables also have `user_id TEXT NOT NULL`

### Scheduler
- `lib/auto-send/scheduler.ts` — node-cron singleton; started from `instrumentation.ts` on server boot
- `global._autoSendStarted` + `global._autoSendTasks` — singleton guards; survive HMR
- `startScheduler()` called from `instrumentation.ts` (nodejs runtime only, skipped on Vercel)
- `refreshScheduler()` called after group create (if interval set), enable toggle, interval change, or delete
- `minutesToCronExpression(minutes)` — `*/N * * * *` for <60m, `0 */N * * *` for hours
- Intervals: 1m, 15m, 30m, 1h, 3h, 6h, 12h, 24h (Manual = no cron)
- **CRITICAL**: `createGroup` MUST call `refreshScheduler` if `intervalMinutes` is set — otherwise scheduler never picks up new groups

### Runner (`lib/auto-send/runner.ts`)
- `runGroup(group)` — executes the group; batch or separate mode
- `previewGroup(group)` — calculates amounts without sending; returns `GroupPreview`
- `calcAmounts(spendable, destinations)` — two-pass: fixed-% first (excluding paused), then remainder gets leftover + any surplus from maxCap clamps
- `skipReason(spendable, amount, minThreshold, paused)` — returns skip reason string or undefined
- `extractError(err)` — extracts real Horizon result_codes from SDK 400 errors
- `FEE_BUDGET = 1.0` XLM — deducted from spendable in BOTH `runGroup` AND `previewGroup` (must stay in sync)
- `DEFAULT_MIN_RESERVE = 10.0` XLM — kept in wallet, not spent
- Separate mode stops on first failure (`aborted` flag) — remaining destinations logged as `"Aborted — earlier payment failed"`
- `previewOnly` groups: scheduler calls `previewGroup` instead of `runGroup`, logs with status `"preview"`

### Key Design Decisions
- **Fee budget flat 1 XLM** (not actual fee × N) — conservative safety buffer; simplifies calculation
- **Stop on first failure in separate mode** — prevents imbalanced distributions that would repeat every run
- **Max cap surplus redistributed to remainder** — if fixed-% dest is capped below calc'd amount, surplus goes to REST destination
- **previewGroup and runGroup MUST use identical spendable formula** — any change to one must be mirrored in the other
- **Run result persists across card collapse/expand** — stored in module-level `Map<string, GroupRunResult>`, not component state
- **`createGroup` always disabled by default on duplicate** — copy starts with `enabled: false`
- **Stranded XLM warning** shown when: `destCount > 0 && !hasRemainder && !overBudget && totalPct < 100`
- **Loading gate**: panel renders spinner until `isLoaded` (from `_cache.isLoaded()`) is true

### Status Badges (collapsed header)
- Green `✓ sent` — last run had `sentCount > 0`
- Red `✗ failed` — last run had `failedCount > 0`
- Yellow `~ skipped` — all skipped, nothing sent or failed
- `lastFailureAt` (group field) — set by scheduler on failure, cleared on full success; shows red banner in expanded card

## Wallet Balances
- Route: `app/(tools)/wallet-balances/page.tsx`
- Panel: `components/wallet-balances/WalletBalancesPanel.tsx`
- **Purpose**: Live XLM balance for every wallet in Wallet Manager; filter by folder or asset group; sort by balance; inline add wallet
- **Data sources**: `useWalletsV2`, `useWalletFolders`, `useAssetGroups`, `useActiveWallet`, `useSettings` — no new DB tables
- **Balance fetch**: `Promise.allSettled` — each wallet resolves independently; `BalanceState = Record<string, "loading" | "error" | number>`
- **Stable fetch dep**: `walletKeys = useMemo(() => wallets.map(w => w.publicKey).sort().join(","), [wallets])` — prevents re-fetch on wallet rename/reorder
- **AbortController**: `abortRef = useRef<AbortController | null>(null)` — abort previous fetch on dep change, abort on unmount
- **Group map**: `walletGroupMap = useMemo(() => new Map<publicKey, {groupName, role}>(), [groups])` — O(1) per-row lookup instead of O(groups×members)
- **Filter**: `filterMode` = `"all" | "folder" | "group"`; `filterId` holds selected id; `__all__` sentinel for Radix Select (empty string `""` is prohibited)
- **Add wallet inline**: validates secret key via `Keypair.fromSecret()`; pre-seeds `"loading"` state before `addWallet()` to avoid undefined flash
- **Secret key indicator**: `KeyRound` icon (yellow, `title` via wrapper `<span>`) if `wallet.secretKey` exists; `Eye` icon (muted) for watch-only wallets
- **Actions per row**: Copy (2s feedback via `copiedId` state), Connect (`setActiveWallet`), Investigate (`/address-investigator?address=`), Send (`/payments`)
- **Mobile**: `overflow-x-auto` outer + `min-w-[640px]` on header + rows

