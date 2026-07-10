# Address Balances — Design

## Purpose
Paste a list of Stellar addresses, get each one's XLM balance and available-to-withdraw amount. Standalone module, no ties to saved wallets (unlike Wallet Balances, which only covers wallets already in Wallet Manager).

## Route & Nav
- `app/(tools)/address-balances/page.tsx` — thin shell (standard module layout).
- `components/address-balances/AddressBalancesPanel.tsx` — `"use client"`, owns all state.
- Add to `lib/navigation.ts`, "Wallets" section, right after "Wallet Balances".

## Input
- Textarea, one `G...` address per line (mirrors Bulk Asset Sales' asset textarea).
- Parse: trim lines, dedupe, validate via `StrKey.isValidEd25519PublicKey`.
- Invalid lines are skipped, not silently dropped — parse-error message shows how many were skipped.

## Data & Fetch Logic
### New: `lib/stellar-reserve.ts`
Pure function extracted fresh (no edits to `my-wallet` or `payments` — those are working modules, not to be touched per module-stability rule):

```ts
interface RawAccountJson {
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{ asset_type: string; balance: string; selling_liabilities?: string }>;
}

function calcAvailableXlm(account: RawAccountJson): { total: number; reserved: number; available: number }
```

Formula (mirrors My Wallet's accurate `calcReserved`, not Payments' simplified version):
```
reserved  = (2 + subentry_count) * 0.5 + num_sponsoring * 0.5 - num_sponsored * 0.5
available = max(0, total_xlm - reserved - native_selling_liabilities)
```

### New: `lib/address-balances/fetchers.ts`
- `fetchAddressBalance(horizonUrl, address, signal)` — fetches raw `/accounts/{address}` JSON directly (not via SDK `loadAccount`, not via the existing `fetchXlmBalance` which only returns a bare number). Returns:
  - `{ status: "unfunded" }` on 404
  - `{ status: "error" }` on non-OK or fetch failure
  - `{ status: "ok", total: number, available: number }` otherwise, using `calcAvailableXlm`
- Same 15s internal timeout + abort-merge pattern as `lib/horizon-balance.ts`.
- Local `runConcurrent` helper in the panel (concurrency 5), copied pattern from `BulkAssetSalesTab.tsx` (no shared version exists yet to import).

## Persistence
- Extend `useBulkScanState<T>(key = "default")` in `hooks/use-bulk-scan-state.ts`:
  - Add `scan_key` column to `bulk_scan_state` table (SQLite `lib/db.ts` + `supabase-schema.sql`), default `"default"`.
  - `/api/db/bulk-scan-state` route reads/writes filtered by `(user_id, scan_key)` instead of just `user_id`.
  - Bulk Asset Sales keeps calling `useBulkScanState<AssetRow>()` unchanged (implicit `"default"` key) — no behavior change for that module.
  - New module calls `useBulkScanState<AddressRow>("address-balances")`.
- Same interrupted-scan banner pattern as Bulk Asset Sales (rows still `pending`/`loading` on reload → marked `error`, "Scan was interrupted").

## Row State
```ts
type AddressRowStatus = "pending" | "loading" | "done" | "error" | "unfunded";
interface AddressRow {
  address: string;
  status: AddressRowStatus;
  total?: number;
  available?: number;
  error?: string;
}
```

## Results UI
- `<Table>` (shadcn): columns `ShortAddress` | Status badge | Balance (XLM) | Available (XLM).
- Unfunded rows: balance/available show "—" with an "unfunded" badge.
- Error rows: show error badge + message.
- No sort/filter, no USD conversion, no CSV export, no per-row actions (Investigate/Send/+Group) — explicitly out of scope for this pass.
- Run / Cancel / Clear buttons + live progress banner (done/error/pending counts) — same as Bulk Asset Sales footer.

## Explicitly Out of Scope
- CSV export
- Sorting/filtering the results table
- USD price conversion
- Per-row action buttons (Investigate, Send, +Group)
- Any change to `my-wallet` or `payments` reserve-calc code (new isolated helper only)
