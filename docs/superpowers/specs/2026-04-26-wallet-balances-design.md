# Wallet Balances Module — Design Spec

**Date:** 2026-04-26  
**Status:** Approved

---

## Overview

A new standalone module that shows the live XLM balance of all saved wallets in one place. Users can filter by wallet folder or asset group, search by name/address, add new wallets inline, and act on individual wallets (copy, connect, send).

---

## Layout Standard (applies to all future modules)

`AppLayout` already wraps every page in `container mx-auto p-4 md:p-8 max-w-7xl`. New pages must **not** add their own `max-w-*` or extra padding. The standard page shell is:

```tsx
export default function MyModulePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Module Name</h1>
        <p className="text-muted-foreground mt-2">Brief description.</p>
      </div>
      <Suspense fallback={<LoadingSpinner />}>
        <ModulePanel />
      </Suspense>
    </div>
  );
}
```

Shared components always used: `<Input>`, `<Button>`, `<Select>` from `@/components/ui`; `<WalletSelect>` for wallet pickers; `<ShortAddress>` for any Stellar address; `createDbCache()` for persistence; never localStorage for new data.

---

## Routes & Files

| Path | Purpose |
|---|---|
| `app/(tools)/wallet-balances/page.tsx` | Page shell — standard template |
| `components/wallet-balances/WalletBalancesPanel.tsx` | All module UI |

No lib files needed — balance fetching is a single Horizon call per wallet; no complex logic to extract.

---

## Data Sources

| Hook / Source | Used for |
|---|---|
| `useWalletsV2()` | All saved wallets (name, publicKey, secretKey, folderId) |
| `useWalletFolders()` | Folder list for filter dropdown and add-wallet folder picker |
| `useAssetGroups()` | Asset groups for filter dropdown; match wallet publicKeys against group members |
| `useActiveWallet()` | Identify which wallet is currently connected (green dot + badge) |
| `useSettings()` | Horizon URL for balance fetching |
| Horizon `/accounts/{address}` | Live XLM balance per wallet |

No new DB tables or API routes required.

---

## UI Structure

### Stats Bar
Three cards across the top:
- **Total XLM** — sum of all visible wallets' balances (updates as balances load)
- **Wallets** — count of wallets currently visible (respects active filter)
- **Low Balance** — count of wallets below the low-balance threshold (default: 20 XLM)

Refresh button on the right re-fetches all balances.

### Filter / Toolbar
Single row:
- `All` pill (default active, purple when selected)
- `Folder ▾` dropdown — lists all wallet folders; selecting one filters to wallets in that folder
- `Asset Group ▾` dropdown — lists all asset groups; selecting one filters to wallets whose `publicKey` appears as a member of that group
- Search input — live filter by wallet name or address substring
- `+ Add Wallet` button — expands the inline add form at the bottom of the table

Only one filter active at a time (folder OR asset group OR all). Search stacks on top of the active filter.

### Table

Columns: **Name** · **Address** · **Group/Folder label** · **XLM** · actions

- **Name** — wallet name from Wallet Manager; green dot prefix if this is the active wallet
- **Address** — `<ShortAddress>` (GABC…WXYZ format)
- **Label** — folder name for wallets matched by folder filter; asset group name + role badge (purple pill) for wallets matched by an asset group
- **XLM** — balance number right-aligned; shows `…` (spinner) while loading, red + ⚠ badge if below low-balance threshold
- **Actions** (icon buttons, right-aligned):
  - ⎘ Copy address to clipboard
  - ⚡ Connect as active wallet (calls `setActiveWallet`)
  - ↗ Open in Address Investigator (pre-fills the address) — My Wallet only shows the connected wallet, not arbitrary addresses
  - ⇧ Navigate to Payments → Send tab

Active wallet row gets a subtle purple background tint and a green `● active` badge instead of the connect icon.

Sorting: click the XLM column header to toggle ascending/descending. Default: descending (highest balance first).

Low balance: row background tints red, balance text is red, ⚠ low badge shown. Threshold is hardcoded at 20 XLM for now (not user-configurable in this phase).

### Add Wallet (inline form)

Appears as a row at the bottom of the table when `+ Add Wallet` is clicked. Fields:
- **Name** — text input
- **Secret key** — password input; public key derived client-side via `Keypair.fromSecret()`
- **Folder** — `<Select>` listing all existing folders; defaults to first folder if one exists
- **Save** button — validates key, derives public key, calls `createWallet()` from `useWalletsV2()`; on success collapses the form and immediately fetches balance for the new wallet
- ✕ to cancel

Validation: non-empty name, valid Stellar secret key (starts with `S`, 56 chars), folder selected.

---

## Balance Fetching

On mount (and on Refresh), fetch all wallet balances concurrently via `Promise.allSettled`. Each fetch:

```ts
const res = await fetch(`${horizonUrl}/accounts/${publicKey}`);
const data = await res.json();
const xlm = data.balances?.find((b) => b.asset_type === "native")?.balance ?? "0";
```

State: `Record<string, "loading" | "error" | number>` keyed by `publicKey`. Each wallet starts as `"loading"`, resolves to a number or `"error"` independently — no wallet blocks another.

On filter change: no re-fetch (balances cached in state until manual Refresh or page reload).

---

## Navigation

Add to sidebar navigation under **Tools** section, below Ghost Payments:

```
Wallet Balances
```

---

## What This Module Does Not Do

- Does not show non-XLM asset balances (out of scope for this phase)
- Does not allow editing wallet names or moving wallets between folders (that's Wallet Manager)
- Does not store any new data in the DB — purely reads from existing hooks + Horizon
- Low-balance threshold is not user-configurable in this phase
