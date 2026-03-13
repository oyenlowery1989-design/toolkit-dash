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
- Display can uppercase for UI consistency, but the actual code sent to Horizon must match on-chain case.

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
| `dex-orderbook` | Working — bid/ask tables, stats cards, depth chart (recharts) |
| `wallet-manager` | Working — folders + wallets + connect/disconnect; header switcher added |
| `payments` | Working — single payment builder with address book integration |
| `address-book` | Working, signed off |
| `saved-analyses` | Working, signed off |
| `settings` | Working — network/Horizon URL + theme config |
| `transactions` | Working — transaction explorer/viewer |

## DB-Backed Hooks (SQLite)
- All critical user data hooks use `createDbCache<T>()` from `lib/db-client.ts`.
- Pattern: module-level `_cache`, `useEffect` subscribes + loads, optimistic writes via `dbPost/dbPatch/dbDelete`.
- API routes live at `/api/db/{table}`. DB file: `stellar-toolkit.db` in project root.
- **Do NOT use localStorage for new persistent data** — add a table to `lib/db.ts` and an API route.
- Intentional localStorage: `use-search-history` factory, `address-generator` page (ephemeral keys, never persisted to DB by design), `use-active-wallet` (mirrors DB for instant restore on mount).
- `lib/local-store.ts` is orphaned — safe to delete.

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

## Real Creator / Ancestry Tracing (Asset Lookup)
- "Trace ancestry →" button appears when `issuerInfo.createdBy` or `distribCreators[addr]` is a known intermediary
- **`traceChainStep(targetAddress, signal, setChain)`** — single step (NOT recursive); user manually controls depth via "Continue →" button
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
- **`ChainDisplay`** (module-level component) needs props: `chain`, `network`, `assetCode`, `issuer`, `horizonUrl`, `knownIntermediaryAddrs`, `onContinue`
  - Uses inline Dialog with label + role selector for "+ Group" action
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
- 9 roles: `issuer`, `distrib`, `creator`, `intermediary`, `bank`, `withdrawal`, `destination`, `service`, `other`
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
- Pending: ancestry tracing ("Who created?") on the investigated address — needs `ChainDisplay`/`CreatorPeek` extraction to shared component

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
- **Known issues to fix**: retry doesn't union completedSteps; `fund-accounts` single tx fails if one account already exists; no per-step live progress during execution; supply scientific notation bug; futurenet Stellar.Expert link broken

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

## Shared Utilities
- `lib/format.ts` — `formatXlm()`, `parseAddresses()`, `shortAddr()` (4+4 addr format)
- `lib/db-client.ts` — `createDbCache<T>()`, `dbPost/dbPatch/dbDelete` (all log errors to console now, not silent swallow)
- `lib/address-resolver.ts` — `resolveAddress()` pure function

