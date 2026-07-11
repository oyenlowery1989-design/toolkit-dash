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
- **Social links** (group-level, optional, independent): `domain`, `telegramChannel`, `telegramLink` — editable inline in the expanded card (same click-to-edit pattern as Notes), surfaced as Globe icon + Telegram icon-with-channel-name-text next to the group name in the collapsed header. URL derivation (scheme prefixing, explicit link wins over derived `t.me/{channel}`) lives in `lib/asset-groups/links.ts` (`normalizeExternalUrl`, `resolveTelegramUrl`)
- **Attributed person** (group-level, optional): `personId` FK to the `persons` table (see `persons` module below) — replaces the earlier flat `personName`/`personRole` fields. "+ Attribute Person" opens a dialog to pick an existing Person or create one inline; unlink via `unlinkGroupPerson(groupId)`. One person per group.
- API: `/api/db/groups` — POST/PATCH/DELETE body must include `type: "group"` or `type: "member"`
- Page: `app/(data)/groups/page.tsx` is a standard Suspense shell; all logic lives in `components/groups/GroupsPanel.tsx` — handles `?autoCreate=1&name=...&assetCode=...&issuer=...&distrib=...&issuerHomeDomain=...&distribHomeDomain=...&network=...` to auto-create group on mount; `?open=ID` syncs on same-tab nav, bypasses search filter, scrolls card into view (once per id)
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

## Asset Sales (single input path — single/bulk tab split removed)
- Route `app/(analysis)/asset-sales/page.tsx` renders `components/asset-sales/AssetSalesTab.tsx` directly (no `<Tabs>`/Panel wrapper — the single-vs-bulk tab distinction was merged away since both always shared the same `fetchAssetXlmProceeds` engine and render components)
- One textarea, one `CODE:ISSUER` (or Lobstr URL) per line — 1 line or many, same input path. Distribution address is auto-inferred (`inferDistribLite`) by default
- **Manual override**: when exactly 1 pair is parsed, an optional "Seller Accounts (override, optional)" textarea appears — paste specific addresses to skip auto-infer entirely (covers the old single-tab manual-entry case and the auto-infer-fails fallback). Hidden when 2+ assets are entered — always auto-infer per asset in that case
- Results render row-count-aware: 1 result renders wide (large asset code, full-width non-truncated `ShortAddress` rows) matching the old single-tab look; 2+ results render as compact summary rows (fixed-width columns) — same `rows.map` block, gated on `rows.length === 1`
- `app/(analysis)/bulk-asset-sales/page.tsx` is now a redirect to plain `/asset-sales` (old bookmarks/dashboard card still work)
- `AssetRow` has `homeDomain?` field fetched from `/accounts/{issuer}` after distrib is inferred; watchdog `useEffect` (`if (running && rows.length > 0 && pendingCount === 0)` → abort + `setRunning(false)`) prevents infinite spinner; progress text `pendingCount === 0 ? "Finalising…" : Scanning ${Math.min(done+error+1, total)} of ${total}…`
- Deep-links all land in the one textarea: `?bulkAssets=` prefills multiple lines; `?asset=`/`?code=`+`?issuer=` prefills one `CODE:ISSUER` line (`?account=` also prefills the override field); `?autorun=1` triggers `handleRun()` once the prefilled text lands. `SavedAnalysesPanel` re-run buttons run in-place (don't navigate here at all); Search History and Asset Lookup's "View full data in Asset Sales" push the `?asset=&issuer=&account=&autorun=1` params
- History hook is `useProceedsHistory.ts` (renamed from the old bulk-only `useBulkProceedsHistory.ts` — same storage key/shape, now the single merged recent-searches list). Presets (a separate save/apply/delete-by-id feature) were removed entirely — Saved Analyses' re-run button covers that use case

## Address Investigator
- `AddressInvestigatorTab.tsx` — imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- **Address profile banner** shown above stat cards: `ShortAddress` (shows intermediary/creator/group badge automatically), home domain with globe icon + external link, Stellar.Expert link
- `homeDomain` fetched from `accountDetails.home_domain` (already loaded via `server.loadAccount`) — reset to `null` on each new search
- **"+ Group" button** on Top Senders and Top Recipients rows — opens inline Dialog with group selector (dropdown of all existing groups) + role selector, calls `upsertMember` directly; skips `NETWORK_FEES` pseudo-address
- Group dialog state: `groupDialog` (address + role), `dialogGroupId` (selected group id), `dialogRole`
- **Ancestry tracing** ("Who created?" in profile banner): uses shared `ChainDisplay` + `traceChainStep` from `components/shared/ChainDisplay.tsx`; state `addressChain`, abort via `realCreatorAbortRef` (pre-aborts on re-trace + unmount); resets on new search and deep-link; passes `assetCode=""`/`issuer=""` so it MUST pass `onAddToGroup` (wired to the existing group dialog above) — internal ChainDisplay dialog would create junk groups
- ChainDisplay/CreatorPeek `network` prop accepts full `Network` type; Stellar.Expert links render only for public/testnet (hidden on futurenet/local)

## Address Book Conflict Warning
- `AddressBookPanel.tsx` imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- `EntryForm` computes `conflict` inline (not a hook) — checks the typed address against all three sources live
- Warning shown only on Add form (not edit). Shows entity name, type, and "View group →" link for group conflicts
- Do NOT auto-add group members to address book — group membership already provides label + badge everywhere via ShortAddress

## Saved Analyses Module
- Hook: `hooks/use-saved-analyses.ts` — DB-backed, stores `SavedAnalysis` (id, name, assetCode, issuer, distribAddresses, network, timestamp, result, notes?, tags?)
- `result` is the full `AssetProceedsResult` — all XLM proceeds/sold/outgoing/onHand + topDestinations
- **Auto-save**: Asset Sales' Bulk tab calls `saveAnalysis()` automatically on each row completion (no manual button needed); Single Asset tab still has manual "Save Analysis" button; Asset Lookup's Distribution Sales feature also auto-saves (added so all three proceeds-producing surfaces share one history)
- `SavedAnalysesPanel` has two views toggled by header buttons:
  - **Table view** (default): sortable by any column (asset, XLM proceeds, asset sold, outgoing, on hand, saved date); click header to sort asc/desc
  - **Cards view**: expandable cards with tags, notes, re-run button, top destinations table
- **Aggregate stats bar**: total XLM proceeds, total outgoing, unique assets, unique issuers, top earner — shown above the list
- **Compare Snapshots** section (`components/saved-analyses/SnapshotCompare.tsx` + `lib/saved-analyses/diff.ts`): groups saved analyses by `assetCode:issuer:network`, shown only for assets with 2+ snapshots. Pick a baseline (older) and compare (newer) snapshot — renders field deltas (XLM proceeds/asset sold/outgoing/on-hand, before → after with signed delta) plus a destinations-diff table (`new`/`increased`/`decreased`/`dropped` per address, sorted by `|delta|` desc). "dropped" means the address fell out of the top-50 `topDestinations` cap, not proven-empty — this is stated in the UI. Collapsed by default, next to Cross-Asset Destinations
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
- Tabs: `FlagsTab.tsx`, `HoldersTab.tsx`, `TradesTab.tsx` (699L — place/batch/cancel sell+buy offers for the distributor; submits real signed transactions, was previously undocumented here — needs explicit user sign-off like any other money-moving tab)
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
| Trace Single Account | Working, signed off — DO NOT TOUCH without explicit sign-off (log panel scroll-guard was ported in under explicit one-off sign-off; policy otherwise unchanged) |
| Scan Intermediary | Working, Phase 1+2 streaming, cluster detection shown |
| Known Intermediaries | Working, signed off — DO NOT TOUCH |
| Known Creators | Working, signed off — DO NOT TOUCH |
| Creator's Accounts | Working — browser-verified end-to-end 2026-07-05 (manufactured testnet fixture: C pays I, I creates A → found at 100% confidence); intermediary prefill + unmount abort fixed; awaiting user sign-off |

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
- **Safety**: `npm run dev` locally starts the REAL auto-send + tiered-rewards cron schedulers (not a mock, not gated by a test flag) — before running the dev server for testing, check the local DB for enabled groups with short intervals to avoid triggering real scheduled payments.

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

## Address Balances
- Route: `app/(tools)/address-balances/page.tsx`
- Panel: `components/address-balances/AddressBalancesPanel.tsx`
- **Purpose**: paste arbitrary Stellar addresses (not tied to saved wallets, unlike Wallet Balances) and see XLM balance + amount available to withdraw for each
- `lib/stellar-reserve.ts` — `calcAvailableXlm()`, pure reserve/available formula: `(2 + subentry_count) * 0.5 + sponsoring*0.5 - sponsored*0.5` reserved, minus native `selling_liabilities`. Extracted fresh (not shared with `my-wallet`/`payments`, which keep their own inline copies per module-stability rule)
- `lib/address-balances/fetchers.ts` — `fetchAddressBalance()`, one raw `/accounts/{address}` Horizon fetch per address, 15s timeout + abort-merge
- Persistence via `useBulkScanState<AddressRow>("address-balances")` — `hooks/use-bulk-scan-state.ts` now takes a `key` param (default `"default"`) so this module and Bulk Asset Sales don't overwrite each other's saved scan state; `bulk_scan_state` table gained a `scan_key` column (SQLite + Supabase) with row id `local:{scanKey}` / composite PK `(user_id, scan_key)`
- **Deploy-time action required on any Supabase project where `bulk_scan_state` already exists** (not just if it has rows — `CREATE TABLE IF NOT EXISTS` is a no-op on ANY pre-existing table, empty or not): the old table has PK `(user_id)` only, no `scan_key` column. Deployed as-is, this breaks BOTH this new module AND Bulk Asset Sales' existing scan persistence with runtime 500s (missing column on `.eq("scan_key",...)`; missing unique constraint for `.upsert(..., {onConflict:"user_id,scan_key"})`). Fix: run `DROP TABLE bulk_scan_state;` then re-run `supabase-schema.sql`'s `CREATE TABLE` for it — safe, this table is only a transient resume-scan cache, never durable user data.
- No CSV export, sort/filter, USD conversion, or per-row actions in this pass (deliberately out of scope — see spec)

## Key Scanner
- Route: `app/(tools)/key-scanner/page.tsx`
- Panel: `components/key-scanner/KeyScannerPanel.tsx` + `components/key-scanner/HitsTable.tsx`
- Lib: `lib/key-scanner/{types,engine,loop}.ts`
- **Purpose**: continuously generates random Stellar ed25519 keypairs, checks each via Horizon, and sorts into a no-balance bucket (404 — account never created on-ledger, ~100% of results) vs a has-balance bucket (200 — a real, already-funded account). Runs indefinitely until stopped. Collision odds against the funded-account set are effectively zero forever (~1.1×10^76 keyspace vs ~8M funded accounts) — this is a demonstration/pool-tracking tool, not a viable strategy, and the UI says so.
- **Local-only, same precedent as `tracer-v2` Watchlist** (`lib/tracer-v2/watcher.ts`): the loop only runs on a persistent Node process (bails on `process.env.VERCEL`), and hit rows hold live secret keys that must never be mirrored to Supabase — so `key_scan_state`/`key_scan_hits` exist ONLY in `lib/db.ts`, no `supabase-schema.sql` entry, and both API routes no-op under `isSupabaseOnly()`.
- **Durability model**: keys are independently random, so there is no scan cursor to resume — "no lost data" only means (1) a hit is written to `key_scan_hits` synchronously the instant it's found, never buffered, and (2) the `key_scan_state` counters/tail are checkpointed via the same debounced-`save()`/un-debounced-`saveImmediate()` idea as `useBulkScanState` (~1.5s debounce; immediate flush on start/stop/hit/error-threshold).
- **Loop driver** (`lib/key-scanner/loop.ts`): NOT a cron interval like the other two schedulers — this is "run flat out until stopped," so it's a self-perpetuating async worker pool instead. `global._keyScanStarted` boot guard (checked BEFORE the singleton object is created, deliberately not `global._keyScanLoop`'s mere existence — the API routes' `getKeyScanState()`/`updateKeyScanConfig()` can call `getSingleton()` and lazily create the object before `instrumentation.ts`'s `startKeyScanLoop()` runs; gating on object-existence would make that a race that silently skips the boot-time DB-resume load).
- **Pacing**: shared token-bucket (`nextSlotAt`) enforces one combined `paced_rps` across all concurrency workers (not per-worker) — default 5 req/s, adjustable live 0.5–10 without a restart. Self-throttles (halves pace) after 5 consecutive Horizon 429s.
- **Concurrency changes are live**: each worker closure checks `index < s.concurrency` every iteration to exit gracefully when concurrency is lowered; raising it spawns additional workers via the same `workerGeneration` (a full Start assigns a fresh generation so old aborted workers can't rejoin after a Stop→Start cycle).
- **Resume on boot**: `resume_on_boot` (default on) is a persisted per-instance choice, distinct from a clean Stop (`running=0`, does not resume) vs a crash (`running` stays `1`, resumes with a visible "Auto-resumed" banner — `state.autoResumed` is an in-memory-only flag, not persisted, so it only shows once per boot).
- **Hook**: `hooks/use-key-scan.ts` is deliberately NOT the `createDbCache` optimistic-write pattern every other DB-backed hook uses — that pattern targets user-driven CRUD with rollback semantics, and this data is continuously mutated server-side. It's a plain poller (1.5s while running, 5s while stopped) that also fires `notifyIfHidden()` when the hit count increases between polls.
- **Secret key handling**: no-balance bucket never stores a secret (worthless — nothing there is ever spendable); has-balance bucket does, since the secret IS the point of a hit. UI never renders a secret inline — `SecretRevealModal` in `HitsTable.tsx` mirrors `address-generator`'s reveal-modal pattern (copy-to-clipboard with a 30s auto-clear countdown, secret only in the DOM while the modal is mounted). CSV export and per-row purge both go through `useConfirmClick` (click-again-to-confirm) since export dumps live secrets to a file.
- **Mainnet only** — `KeyScanNetwork` is a single-literal type (`"public"`), no testnet/futurenet picker in the UI; checking for an existing balance only means something against the real ledger.

## Local Dev & Testing Notes
- To browser-test a page's layout/theme without real Supabase credentials: `document.cookie = "sb-logged-in=1"` (via browser eval) gets past the middleware page-redirect gate. API routes still 401 (real JWT required via `requireAuth`) — this only unblocks shell/layout rendering, not data-dependent UI states.
- Playwright MCP screenshot files save to the repo root by default (not `.playwright-mcp/`, despite that folder appearing in tool output) — clean up (`rm *.png`, `rm -rf .playwright-mcp`) after a browser-testing session so they don't show up in `git status`.

