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
- **Exception: `"XLM"` is a native-asset sentinel, not a real ledger code** — always detect it case-insensitively (`code.toUpperCase() === "XLM"`) and normalize to canonical `"XLM"` at every entry point (manual input, JSON import). This applies only to the native-asset sentinel, never to real custom asset codes.

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
- Track unfinished features and surface them in reviews. (`detectClusters` is DONE — built in `lib/intermediary-tracer/matcher.ts`, rendered + save-to-DB wired in ScanIntermediaryTab.)
- To verify a "looks unused" claim before deleting: run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` as a one-off (don't add to tsconfig) — flags true dead locals/params, but exported symbols still need a repo-wide grep since exports never count as "unused" to TS.

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
        <Suspense
          fallback={
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          }
        >
          <MyPanel />
        </Suspense>
      </div>
    );
  }
  ```
- Always use shared UI components: `<Input>`, `<Button>`, `<Select>` from `@/components/ui`; `<WalletSelect>` for wallet pickers; `<ShortAddress>` for any Stellar address display.
- Never use raw HTML `<input>`, `<button>`, `<select>` in module UI. For boolean toggles use `<Switch>` (there is no shared `Checkbox` yet — every module so far has used `Switch` for on/off settings, even ones that read like a checkbox, e.g. "drain first", "auto-delete").

### Creating a New Module — Checklist
1. **Route**: add `app/(group)/my-module/page.tsx` in whichever route group matches the sidebar section (`(analysis)`, `(tools)`, `(config)`, `(data)`) — check `lib/navigation.ts` for the section list and add the sidebar entry there.
2. **`page.tsx`**: thin shell only — h1 + description + `<Suspense>` wrapping the panel (exact snippet above). Never put fetch logic, `useState`, or `"use client"` in `page.tsx` itself.
3. **Panel**: `components/my-module/MyModulePanel.tsx`, `"use client"`. Owns all state/tabs. If the module has multiple tabs, split each tab into its own file (`components/my-module/TabOneTab.tsx`, etc.) and keep the panel itself as a thin `<Tabs>` shell — this is the pattern used by `intermediary-tracer`, `trustline-manager`, `asset-creator` (all "Clean decomposition"); do not repeat the giant-single-file pattern (`AssetLookupPanel`, `AddressInvestigatorTab`, `GhostPaymentsPanel`, `payments/page.tsx` — all 1300+ lines) unless the module is genuinely simple enough to stay under a few hundred lines.
4. **Lib layer**: `lib/my-module/types.ts` (types + any role/constant enums), `lib/my-module/index.ts` or `fetchers.ts`/`runner.ts`/`builder.ts` split (mirror `asset-creator` or `trustline-manager` for a multi-file split, `asset-manager` for a single `index.ts`). Pure functions only — no React, no `"use client"`. Every fetcher takes `onLog`/`onResult` callbacks (see Fetcher Pattern above) and an `AbortSignal`.
5. **Network**: always read from `useSettings()` — never add a per-module network selector. For a plain Horizon server instance, use `useHorizonServer()` (below) instead of hand-rolling `new Horizon.Server(url)`.
6. **If the module submits transactions**: reuse `getErrorMessage`/`extractHorizonResult`-style helpers from `lib/stellar-helpers.ts` for error parsing; if it can plausibly run concurrently with itself (a scheduler + a manual trigger, e.g. auto-send-groups/tiered-rewards), wrap the per-key submission in `withAccountLock` from `lib/stellar-submit.ts` — this only serializes *submission order* for one process, it is **not** a cross-process/serverless lock (see Tiered Rewards' `_runningConfigs` pattern below for how to add a same-process re-entrancy guard on top when double-execution itself — not just bad sequence numbers — is the risk).
7. **If the module persists user data**: add a table to `lib/db.ts` **and** the matching table in `supabase-schema.sql` (do this in the same edit — a module has shipped before with a table missing from one of the two and it silently broke Vercel deploys), a route at `app/api/db/my-table/route.ts` following the dual-mode (`isSupabaseOnly()`) pattern in any existing route, and a hook via `createDbCache<T>()` (see DB-Backed Hooks below). Never use `localStorage` for anything that should survive across devices/sessions.
8. **Before writing any new UI or utility**: check the Reusable Components & Utilities catalog below — most address display, CSV export, group-save, XLM/USD pricing, and stats-card needs are already covered by a shared component. Writing a second copy of any of these is the single most common finding in this project's module reviews.
9. **Update this file**: add a row to the Module Inventory table and a short section for the module once it is signed off, following the terse style of the existing module sections (route, panel, lib files, one line per non-obvious behavior — not a tutorial).

## Module Inventory
| Module | Status |
|---|---|
| `address-investigator` | Working — recently updated with home domain, group buttons |
| `asset-lookup` | Working, signed off — Save/Open Group button is context-aware (checks `useAssetGroups()`); Distribution Sales feature now also auto-saves to Saved Analyses (one-line wiring, no other changes to this file) |
| `search-history` | Working, signed off — standard page shell, filter uses shared `<Input>` |
| `asset-sales` (proceeds) | Working — single/bulk tab split removed, one input path (paste 1 or many `CODE:ISSUER` lines); `bulk-asset-sales` route still redirects here. Auto-infer distrib with optional manual-accounts override (1-asset only), context-aware group buttons, live destination-balance check |
| `intermediary-tracer` | Mostly complete — see notes below |
| `address-generator` | Working — Web Worker vanity address generator; reviewed+fixed 2026-07-06 (Stop button didn't set the same staleness guard the internal search-complete path uses, could revert UI out of "stopped" after an already-queued worker message landed) |
| `bulk-payments` | Working — secret key field replaced by active wallet indicator when wallet connected; reviewed+fixed 2026-07-06 (fatal-throw false-success, stale exclude-list, abort-on-unmount) |
| `ghost-payments` | Working — secret key field replaced by active wallet indicator when wallet connected; reviewed+fixed 2026-07-06 (2 CRITICAL: no_trust mode's "no funds will move" guarantee was bypassable, underfunded overshoot only checked sender #1) |
| `asset-creator` | Working — 4-step wizard: accounts, asset config, preflight, execution; auto-saves to Asset Groups; reviewed+fixed 2026-07-06 (CRITICAL: issuance step could double-mint full supply on retry, now idempotency-guarded) |
| `asset-manager` | Working — shared asset input panel + Asset Flags tab + Holders tab (trustlines + sell offers combined) + Trades tab (place/batch/cancel DEX offers, real money — needs sign-off); reviewed+fixed 2026-07-06 (CRITICAL: AUTH_IMMUTABLE toggle had no confirmation dialog; CRITICAL: connected wallet's signer never checked against typed issuer, could silently mutate wrong account) |
| `account-funder` | Working — bulk keypair generator + createAccount funder; Direct/Sponsored/Close tabs; save to Asset Group; reviewed+fixed 2026-07-06 (CRITICAL: atomic-tx rollback still showed op_success as "funded"; CRITICAL: Regenerate had no confirm, could permanently destroy keys for already-funded addresses) |
| `trustline-manager` | Working — Single tab (add/remove/drain) + Bulk tab (N assets × M accounts matrix); auto-delete toggle; reviewed+fixed 2026-07-06 (CRITICAL: stale drain-destination after wallet switch; HIGH: fee-squaring up to 100x across 4 sites) |
| `soroban` | Working — SAC deploy wizard for wrapping existing classic assets; manual "Recheck" button wired to status check; reviewed+fixed 2026-07-06 (HIGH: stale issuer + XLM code combo silently computed wrong non-native contract) |
| `dex-orderbook` | Working — bid/ask tables, stats cards, depth chart (recharts); reviewed+fixed 2026-07-06 (XLM-sentinel bug, abort-race, deep-link query params, paste-to-parse) |
| `wallet-manager` | Working — folders + wallets + connect/disconnect; header switcher added; reviewed+fixed 2026-07-06 (HIGH: failed folder-delete left wallets permanently purged from UI though intact in DB; HIGH: no cross-tab signal on wallet delete, background tab kept exposing stale secret key) |
| `my-wallet` | Working — connected wallet overview: XLM/Available/Reserved/30d-net-flow cards, reserve breakdown popup, home domain (editable inline), thresholds+sequence, account flags (AUTH_REQUIRED etc), inflation dest, signers, claimable balances (claim), assets+trustlines (DEX/Send/Remove icons), open offers, payment history (in/out), recent txs, merge account (danger zone), quick actions — all sections collapsible via `Section` component; reviewed+fixed 2026-07-06 (CRITICAL: wallet switch mid-merge-flow did not reset stale destination/confirm state — could merge new wallet's balance to old wallet's typed destination) |
| `payments` | Working — Send (multi-leg, Max, remove-trustline + offer cancel), Path (strict-receive + strict-send), Claimable Balance, Fee Bump; ShortAddress on all destinations; reviewed+fixed 2026-07-06 (Max button reserve/liabilities calc, buying-side offer cancellation, stale path selection) |
| `address-book` | Working, signed off |
| `saved-analyses` | Working, signed off — distribution addresses render via `<ShortAddress>` |
| `settings` | Working — network/Horizon URL + theme config; reviewed+fixed 2026-07-06 (CRITICAL: page staged network selection in local state with no re-sync — could silently revert an in-app network switch made via the sidebar, app-wide blast radius) |
| `transactions` | Working — transaction explorer/viewer; reviewed+fixed 2026-07-06 (CRITICAL: every DEX offer + claimable-balance op mislabeled its asset as XLM) |
| `auto-send-groups` | Working — scheduled XLM distribution groups; see full section below; UI fully converted to shared `Button`/`Input`/`Select` (no raw HTML form elements, theme-safe in light mode); reviewed+fixed (2 CRITICAL cross-tenant auth bugs) |
| `tiered-rewards` | Working — tiered per-holder reward distribution; multi-asset tiers; scheduled or manual; batch/separate mode; JSON import; preview modal; run history; XLM sentinel handled case-insensitively throughout; `dbAction` rolls back optimistic cache + toasts on server rejection; reviewed+fixed 2026-07-06 (2 CRITICAL: Supabase update wiped secret_key/schedule on every patch, no execution-lock risked full double-payment) |
| `wallet-balances` | Working — live XLM balance across all saved wallets; filter by folder or asset group; sort by balance; inline add wallet; copy/connect/investigate/send actions; reviewed+fixed 2026-07-06 (hung balance fetch could permanently disable the page's only Refresh button) |
| `address-balances` | Working, awaiting sign-off — paste a list of Stellar addresses, see XLM balance + available-to-withdraw per address (reserve/liabilities-aware, via new `lib/stellar-reserve.ts`); persists in-progress scans via `useBulkScanState("address-balances")` (scan_key isolation added so this doesn't clobber Bulk Asset Sales' own scan state) |
| `tracer-v2` | Working, awaiting sign-off — 4 tabs: **Operator Fingerprint** (pure DB cross-group correlator, dampened prob-OR scoring + IDF noise suppression + issuer/distrib short-circuit), **Bulk Trace** (concurrent worker-pool origin trace reusing `traceAccountOrigin`, live stream + CSV), **Watchlist** (SQLite tables + routes + hooks + read-only 5-min cron poller for new `create_account` events; local-only, `isSupabaseOnly()` no-op guard; wired into `instrumentation.ts`), **Flow Graph** (pure `graph-builder` + hand-rolled force sim, no d3 dep; interactive SVG pan/zoom/drag + fingerprint cross-highlight). Route `app/(analysis)/tracer-v2`. Pure engines unit-tested (23 tests): `lib/tracer-v2/{fingerprint,bulk-trace,watcher,graph-builder,force-sim}.ts`. Imports intermediary-tracer exports ONLY — never edits it. `watcher.ts` inlines Horizon URLs (must NOT import `@/lib/settings` — that pulls a client hook into the server bundle). Spec+plan: `docs/superpowers/{specs,plans}/2026-07-06-tracer-v2*` |
| `persons` | Working, signed off — standalone Persons registry (name/role/notes + linked addresses + own `telegramChannel`/`telegramLink` pair, same `resolveTelegramUrl` resolver as Asset Groups — person-level, separate from the group-level Telegram Channel Clusters feature below), attributable to Asset Groups via a single `person_id` FK. Route `app/(data)/persons/page.tsx`, panel `components/persons/PersonsPanel.tsx`. Lib: `lib/persons/types.ts` (`Person`, `PersonAddress`). Hook: `hooks/use-persons.ts` (`createDbCache` pattern, entity+children shape mirroring `use-asset-groups.ts`). API: `/api/db/persons` (dual-mode, entity+children shape mirroring `/api/db/groups`). One attributed person per asset group (not multiple); role lives on the person record, not per-group. Person delete cascades: `asset_groups.person_id` → `ON DELETE SET NULL` (group reverts to unattributed, not an error), `person_addresses` → `ON DELETE CASCADE`. Person-based clustering ("group by CEO") needs no dedicated view — each Person card's "Attributed to N asset group(s)" list already is that view. **Telegram-channel clustering** (`components/persons/TelegramChannelClusters.tsx`, rendered below the person grid): aggregates asset groups by `telegramChannel` normalized (lowercase, strip leading `@`/`/`) — cross-cuts Person, so it surfaces groups sharing a channel even with no Person in common; "mixed persons" badge when a channel's groups carry >1 distinct attributed person. Not integrated into `lib/address-resolver.ts`'s `ShortAddress` badge chain. `?open=ID` deep-link scroll-into-view intentionally not implemented in this first pass (see Asset Groups' version for the pattern if adding later). Spec+plan: `docs/superpowers/{specs,plans}/2026-07-08-persons-module*`, `docs/superpowers/{specs,plans}/2026-07-08-persons-clustering-view*` |
| `key-scanner` | Built, awaiting sign-off — continuously generates random Stellar keypairs, checks each via Horizon, sorts into a no-balance / has-balance bucket, runs until stopped. See full section below. |

## DB-Backed Hooks (SQLite)
- All critical user data hooks use `createDbCache<T>()` from `lib/db-client.ts`.
- Pattern: module-level `_cache`, `useEffect` subscribes + loads, optimistic writes via `dbPost/dbPatch/dbDelete`.
- API routes live at `/api/db/{table}`. DB file: `stellar-toolkit.db` in project root.
- **Do NOT use localStorage for new persistent data** — add a table to `lib/db.ts` and an API route.
- Intentional localStorage: `use-search-history` factory, `address-generator` page (ephemeral keys, never persisted to DB by design), `use-active-wallet` (mirrors DB for instant restore on mount).
- **Never hand-roll a `fetch()` wrapper for DB writes** — always use `dbPost`/`dbPatch`/`dbDelete`, which throw on non-OK responses. Pair every write with `.catch(() => _cache.reload(ENDPOINT))` so a server-side rejection (e.g. validation 400) rolls back the optimistic cache update instead of leaving it stuck client-side until the next reload silently erases it.

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

## Reusable Components & Utilities
Check this list before writing a new address-display row, CSV export, save-to-group button, stats card, or fetch-retry wrapper — duplicating one of these is the single most common finding in this project's module reviews.

### Shared UI Components (`components/shared/`)
- `<ShortAddress address network />` (`components/shared/ShortAddress.tsx`) — the ONLY correct way to render any Stellar address. Subscribes to Address Book / Known Intermediaries / Known Creators / Asset Groups and renders the right badge automatically (see Address Resolution section above for priority order). Renders its own internal copy button — **never wrap it in a `<button>`/`<Button>`** (invalid nested-interactive-element HTML); if the containing row needs to be clickable, use `<div role="button" tabIndex={0} onClick/onKeyDown>` with `onClick={e => e.stopPropagation()}` on ShortAddress's wrapper instead.
- `<AuthFlag flag label />` (`components/shared/AuthFlag.tsx`) — small badge for AUTH_REQUIRED/REVOCABLE/CLAWBACK/IMMUTABLE-style flags.
- `<ChainDisplay />` + `<CreatorPeek />` + `traceChainStep()` + `fetchHomeDomain()` (`components/shared/ChainDisplay.tsx`) — the entire "who really created/funded this account" ancestry-tracing UI and logic, one hop per click. Used by Asset Lookup and Address Investigator; see the full contract in the "Real Creator / Ancestry Tracing" section above before touching this file.
- Import all of the above from `@/components/shared` (barrel export) or the specific file — both work.

### Proceeds/Destinations UI (`components/shared/proceeds/`)
Built for the asset-sales family, now also used by Address Investigator's sender/recipient tables — generalize further before writing a bespoke destinations table.
- `<ProceedsDestinationsTable destinations totalXlmProceeds network ... />` — the standard table for any "list of counterparty addresses with an XLM total and tx count" view. Optional props cover both the proceeds case (`showGroupAction`, `assetCode`/`issuer`) and the no-asset-context case (`onAddToGroup` callback instead — required whenever the caller has no `assetCode`/`issuer`, e.g. Address Investigator). Also: `showPercentColumn`, `percentColumnLabel`, `addressColumnLabel`, `showProgressBar`, `onDownloadCsv`, `onInvestigate`, `emptyMessage`. **`showBalanceColumn`** (default `true`) adds a "Holds Now" column with a lazy per-row (or "check top 10") live-balance check via `fetchXlmBalance` (`lib/horizon-balance.ts`) — surfaces whether a destination still holds the XLM it received or has moved it on, distinct from the historical `%` column which never changes. Since this is default-on, every existing caller (asset-sales, asset-lookup's Distribution Sales, Address Investigator) gets the column automatically with no caller edit.
- `<ProceedsStatsCards ... />` — the row of summary stat cards (XLM proceeds, asset sold, outgoing, on-hand style cards).
- `<ProceedsStatusBadge status />` + `ProceedsScanStatus` type — scan-in-progress/done/error badge.
- `<SaveToGroupButton assetCode issuer network targetAddress />` — context-aware "Save to Group" / "Open Group →" / "✓ in group" button (see Asset Groups section above for the exact state logic). Supports separate `homeDomain`/`distribHomeDomain` props and a `size="sm"` variant.

### `components/ui/` (shadcn kit)
`Button`, `Input`, `Label`, `Select`, `Switch`, `Dialog`, `Card`, `Table`, `Tabs`, `Tooltip`, `Badge`, `WalletSelect`. No `Checkbox` exists yet — use `Switch` for any boolean toggle.

### Lib Utilities
- `lib/format.ts` — `formatXlm()`, `parseAddresses()`, `shortAddr()` (4+4 addr format — always import this, never hand-roll `slice(0,4)+"…"+slice(-4)`).
- `lib/db-client.ts` — `createDbCache<T>()`, `dbPost/dbPatch/dbDelete` (throw on non-OK; always pair a write with `.catch(() => _cache.reload(ENDPOINT))` so a server rejection rolls back the optimistic update).
- `lib/address-resolver.ts` — `resolveAddress()` pure function backing `ShortAddress`'s badge logic.
- `lib/asset-pair.ts` — `parseAssetPair(raw)` / `parseAssetPairs(text)` — parses `CODE:ISSUER` pairs (and Lobstr trade URLs) out of pasted text/textareas. Used by asset-lookup/asset-sales/bulk-asset-sales/dex-orderbook; use this instead of writing another regex for the same shape.
- `lib/trade-helpers.ts` — `resolveAssetToXlmTrade(raw, account, assetCode, issuer)` — case-insensitive DEX trade-direction resolution (sold vs received against XLM). Reuse this rather than re-deriving buy/sell direction from a raw trade record.
- `lib/csv-export.ts` — `downloadCSV()` — proper quoting/escaping CSV export. Never hand-roll a comma-joined CSV string (this has been a real bug — unescaped commas/quotes corrupt rows).
- `lib/horizon-fetch.ts` — `fetchJson()` with retry/backoff on 429/502/503/504 and abort-awareness. The standard fetch wrapper for any raw Horizon REST call not already covered by the Stellar SDK.
- `lib/stellar-helpers.ts` — `getErrorMessage()` (extracts `result_codes` from a Horizon 400 into a readable `"tx: ... | ops: ..."` string).
- `lib/stellar-submit.ts` — `withAccountLock(publicKey, fn)` / `isBadSeq(err)` — serializes transaction submission order per signing key within one process (prevents bad-sequence races between a scheduler and a manual trigger sharing a key). Not a cross-process lock — see the Creating-a-New-Module checklist above for when you need more than this.
- `lib/notifications.ts` — `notifyIfHidden(title, body)` — fires a browser notification only when the tab is backgrounded; always branch on real success/failure counts when composing the message (a bug fixed this session: some callers reported "N sent" using the total recipient count regardless of how many actually failed).
- `lib/navigation.ts` — sidebar `menuItems` structure (5 sections: Analysis, Payments, Asset Lifecycle, Wallets, My Data); add new modules here.

### Hooks
- `useHorizonServer(network?)` (`hooks/use-horizon-server.ts`) — memoized `Horizon.Server` instance + its URL, defaults to the global network setting; re-instantiates only when the resolved URL changes. Prefer this over `new Horizon.Server(...)` inline in a component.
- `useXlmUsdPrice()` (`hooks/use-xlm-usd-price.ts`) — module-level singleton price cache (60s TTL, request-deduped across every caller). Call `ensure()` at the point you'd otherwise fire a raw CoinGecko fetch; read `price` for the current value.
- `useAutoSaveSigningKey()` (`hooks/use-auto-save-signing-key.ts`) — `autoSave(publicKey)` files a manually-entered signing key into the "My Keys" asset group (role `other`) if it isn't already tracked anywhere, so one-off secret-key entry doesn't leave an untracked address.
- `useBulkScanState<T>()` (`hooks/use-bulk-scan-state.ts`) — DB-backed persistence for a long-running scan's row state, with a debounced `save()` for frequent per-row updates and an un-debounced `saveImmediate()` for start/finish checkpoints; use this instead of `localStorage` for any "resume an interrupted scan" feature (this replaced bulk-asset-sales' original localStorage implementation).
- Every module-data hook (`use-asset-groups`, `use-address-book`, `use-known-intermediaries`, `use-known-creators`, `use-wallets-v2`, `use-wallet-folders`, `use-auto-send-groups`, `use-tiered-reward-configs`, `use-saved-analyses`, `use-search-history`, ...) follows the `createDbCache<T>()` pattern from `lib/db-client.ts` — module-level cache, `useEffect` subscribe+load, optimistic writes with rollback. Copy the shape of the nearest existing hook rather than inventing a new persistence pattern.

## Local Dev & Testing Notes
- To browser-test a page's layout/theme without real Supabase credentials: `document.cookie = "sb-logged-in=1"` (via browser eval) gets past the middleware page-redirect gate. API routes still 401 (real JWT required via `requireAuth`) — this only unblocks shell/layout rendering, not data-dependent UI states.
- Playwright MCP screenshot files save to the repo root by default (not `.playwright-mcp/`, despite that folder appearing in tool output) — clean up (`rm *.png`, `rm -rf .playwright-mcp`) after a browser-testing session so they don't show up in `git status`.

