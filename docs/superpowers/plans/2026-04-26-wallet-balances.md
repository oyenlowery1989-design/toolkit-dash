# Wallet Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone module that shows live XLM balances for all saved wallets, with folder/group filtering, sorting, inline wallet add, and per-row actions.

**Architecture:** Single panel component (`WalletBalancesPanel.tsx`) reads from existing hooks (`useWalletsV2`, `useWalletFolders`, `useAssetGroups`, `useActiveWallet`, `useSettings`) and fetches Horizon balances concurrently. No new DB tables or API routes needed.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, lucide-react, stellar-sdk (`Keypair`), existing ui components (`Input`, `Button`, `Select`), existing hooks.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `app/(tools)/wallet-balances/page.tsx` | Create | Standard page shell |
| `components/wallet-balances/WalletBalancesPanel.tsx` | Create | All module UI |
| `lib/navigation.ts` | Modify | Add sidebar entry after Tiered Rewards |

---

## Task 1: Page shell + navigation entry

**Files:**
- Create: `app/(tools)/wallet-balances/page.tsx`
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Create the page file**

```tsx
// app/(tools)/wallet-balances/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { WalletBalancesPanel } from "@/components/wallet-balances/WalletBalancesPanel";

export default function WalletBalancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet Balances</h1>
        <p className="text-muted-foreground mt-2">
          Live XLM balance across all saved wallets. Filter by folder or asset group.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <WalletBalancesPanel />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Add navigation entry to `lib/navigation.ts`**

Add `LayoutList` to the existing lucide-react import at the top of `lib/navigation.ts`:

```ts
import {
  // ... existing imports ...
  LayoutList,
} from "lucide-react";
```

Then insert after the Tiered Rewards entry (after `href: "/tiered-rewards"`):

```ts
  {
    title: "Wallet Balances",
    href: "/wallet-balances",
    icon: LayoutList,
  },
```

- [ ] **Step 3: Create the panel stub so the page compiles**

```tsx
// components/wallet-balances/WalletBalancesPanel.tsx
"use client";

export function WalletBalancesPanel() {
  return <div className="text-muted-foreground text-sm py-8 text-center">Coming soon…</div>;
}
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/(tools)/wallet-balances/page.tsx components/wallet-balances/WalletBalancesPanel.tsx lib/navigation.ts
git commit -m "feat(wallet-balances): add page shell and navigation entry"
```

---

## Task 2: Balance fetching + stats bar

**Files:**
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx`

- [ ] **Step 1: Replace stub with data wiring and stats bar**

```tsx
// components/wallet-balances/WalletBalancesPanel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useSettings } from "@/lib/settings";
import { resolveHorizonUrl } from "@/lib/settings";

type BalanceState = Record<string, "loading" | "error" | number>;

const LOW_BALANCE_THRESHOLD = 20;

async function fetchXlmBalance(horizonUrl: string, publicKey: string): Promise<number | "error"> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${publicKey}`);
    if (!res.ok) return "error";
    const data = await res.json();
    const xlm = data.balances?.find((b: { asset_type: string }) => b.asset_type === "native")?.balance;
    return xlm ? parseFloat(xlm) : "error";
  } catch {
    return "error";
  }
}

export function WalletBalancesPanel() {
  const { wallets, addWallet } = useWalletsV2();
  const { folders } = useWalletFolders();
  const { groups } = useAssetGroups();
  const { activeWallet, connect } = useActiveWallet();
  const { settings } = useSettings();

  const [balances, setBalances] = useState<BalanceState>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const horizonUrl = resolveHorizonUrl(settings);

  const fetchAllBalances = useCallback(async () => {
    if (wallets.length === 0) return;
    const initial: BalanceState = {};
    for (const w of wallets) initial[w.publicKey] = "loading";
    setBalances(initial);

    await Promise.allSettled(
      wallets.map(async (w) => {
        const result = await fetchXlmBalance(horizonUrl, w.publicKey);
        setBalances((prev) => ({ ...prev, [w.publicKey]: result }));
      })
    );
  }, [wallets, horizonUrl]);

  useEffect(() => {
    fetchAllBalances();
  }, [fetchAllBalances, refreshKey]);

  const resolvedBalances = Object.values(balances).filter((v): v is number => typeof v === "number");
  const totalXlm = resolvedBalances.reduce((sum, b) => sum + b, 0);
  const lowCount = resolvedBalances.filter((b) => b < LOW_BALANCE_THRESHOLD).length;
  const loadingCount = Object.values(balances).filter((v) => v === "loading").length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total XLM</p>
          <p className="text-xl font-bold text-purple-400 mt-0.5">
            {loadingCount > 0 ? "…" : totalXlm.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[80px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Wallets</p>
          <p className="text-xl font-bold mt-0.5">{wallets.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[100px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Low Balance</p>
          <p className={`text-xl font-bold mt-0.5 ${lowCount > 0 ? "text-destructive" : ""}`}>{lowCount}</p>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loadingCount > 0}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingCount > 0 ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {wallets.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No wallets saved yet. Add wallets in the Wallet Manager.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet-balances/WalletBalancesPanel.tsx
git commit -m "feat(wallet-balances): add balance fetching and stats bar"
```

---

## Task 3: Filter toolbar

**Files:**
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx`

- [ ] **Step 1: Add filter + search state, imports, and toolbar UI**

Add to the existing imports at the top of the file:

```tsx
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

Add these state variables inside `WalletBalancesPanel`, after the existing state:

```tsx
  type FilterMode = "all" | "folder" | "group";
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterId, setFilterId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
```

Add this computed `visibleWallets` after the stats calculations:

```tsx
  const visibleWallets = wallets.filter((w) => {
    if (filterMode === "folder" && filterId) {
      if (w.folderId !== filterId) return false;
    }
    if (filterMode === "group" && filterId) {
      const group = groups.find((g) => g.id === filterId);
      if (!group) return false;
      if (!group.members.some((m) => m.address === w.publicKey)) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!w.name.toLowerCase().includes(q) && !w.publicKey.toLowerCase().includes(q)) return false;
    }
    return true;
  });
```

Add the toolbar between the stats bar and the empty-state check:

```tsx
      {/* Toolbar */}
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          size="sm"
          variant={filterMode === "all" ? "default" : "outline"}
          onClick={() => { setFilterMode("all"); setFilterId(""); }}
          className={filterMode === "all" ? "bg-purple-600 hover:bg-purple-700 text-white" : ""}
        >
          All
        </Button>
        <Select
          value={filterMode === "folder" ? filterId : ""}
          onValueChange={(val) => {
            if (val) { setFilterMode("folder"); setFilterId(val); }
            else { setFilterMode("all"); setFilterId(""); }
          }}
        >
          <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue placeholder="Folder…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Folders</SelectItem>
            {folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filterMode === "group" ? filterId : ""}
          onValueChange={(val) => {
            if (val) { setFilterMode("group"); setFilterId(val); }
            else { setFilterMode("all"); setFilterId(""); }
          }}
        >
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue placeholder="Asset Group…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Groups</SelectItem>
            {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          className="flex-1 min-w-[160px] h-9 text-sm"
          placeholder="Search name or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Wallet"}
        </Button>
      </div>
```

Also update the empty-state condition to use `visibleWallets`:

```tsx
      {visibleWallets.length === 0 && wallets.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">No wallets match the current filter.</p>
      )}
      {wallets.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No wallets saved yet. Add wallets in the Wallet Manager.
        </p>
      )}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet-balances/WalletBalancesPanel.tsx
git commit -m "feat(wallet-balances): add filter toolbar and search"
```

---

## Task 4: Wallet table with actions

**Files:**
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx`

- [ ] **Step 1: Add sort state and table UI**

Add these imports at the top:

```tsx
import { Copy, Search, Zap, ArrowUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { ShortAddress } from "@/components/ui/short-address";
```

Add sort state inside the component:

```tsx
  const router = useRouter();
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
```

Add `sortedWallets` computed after `visibleWallets`:

```tsx
  const sortedWallets = [...visibleWallets].sort((a, b) => {
    const ba = typeof balances[a.publicKey] === "number" ? (balances[a.publicKey] as number) : -1;
    const bb = typeof balances[b.publicKey] === "number" ? (balances[b.publicKey] as number) : -1;
    return sortDir === "desc" ? bb - ba : ba - bb;
  });
```

Replace the empty-state blocks with the full table (keep the empty-states, add the table between them):

```tsx
      {/* Table */}
      {wallets.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_140px_140px_auto_auto] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/30">
            <span>Name</span>
            <span>Address</span>
            <span>Folder / Group</span>
            <button
              className="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
              onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
            >
              XLM <ArrowUpDown className="h-3 w-3" />
            </button>
            <span className="w-24" />
          </div>

          {/* Rows */}
          {sortedWallets.map((wallet) => {
            const bal = balances[wallet.publicKey];
            const isActive = activeWallet?.id === wallet.id;
            const isLow = typeof bal === "number" && bal < LOW_BALANCE_THRESHOLD;

            // Folder or group label
            const folder = folders.find((f) => f.id === wallet.folderId);
            const memberGroup = groups.find((g) => g.members.some((m) => m.address === wallet.publicKey));
            const memberRole = memberGroup?.members.find((m) => m.address === wallet.publicKey)?.role;

            return (
              <div
                key={wallet.id}
                className={`grid grid-cols-[1fr_140px_140px_auto_auto] gap-3 px-4 py-2.5 items-center border-b border-border last:border-0 text-sm transition-colors ${isActive ? "bg-purple-500/5" : isLow ? "bg-destructive/5" : "hover:bg-muted/20"}`}
              >
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${isActive ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  <span className={`truncate font-medium ${isLow ? "text-destructive" : ""}`}>{wallet.name}</span>
                  {isActive && (
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">active</span>
                  )}
                </div>

                {/* Address */}
                <span className="text-muted-foreground font-mono text-xs">
                  <ShortAddress address={wallet.publicKey} />
                </span>

                {/* Label */}
                <div className="text-xs text-muted-foreground truncate">
                  {memberGroup ? (
                    <span>
                      {memberGroup.name}
                      {memberRole && (
                        <span className="ml-1 px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 uppercase text-[10px]">{memberRole}</span>
                      )}
                    </span>
                  ) : folder ? folder.name : "—"}
                </div>

                {/* Balance */}
                <div className="text-right min-w-[90px]">
                  {bal === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                  ) : bal === "error" ? (
                    <span className="text-xs text-muted-foreground">error</span>
                  ) : (
                    <span className={`font-mono font-semibold ${isLow ? "text-destructive" : "text-purple-400"}`}>
                      {(bal as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {isLow && <span className="ml-1.5 text-xs">⚠</span>}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 w-24 justify-end">
                  <button
                    title="Copy address"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => navigator.clipboard.writeText(wallet.publicKey)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {!isActive && (
                    <button
                      title="Connect as active wallet"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => connect(wallet.id)}
                    >
                      <Zap className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    title="Open in Address Investigator"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => router.push(`/address-investigator?address=${wallet.publicKey}`)}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Go to Payments"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => router.push("/payments")}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet-balances/WalletBalancesPanel.tsx
git commit -m "feat(wallet-balances): add wallet table with sort and actions"
```

---

## Task 5: Inline add-wallet form

**Files:**
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx`

- [ ] **Step 1: Add imports and form state**

Add to existing imports (Input and Select already imported in Task 3 — only add new ones):

```tsx
import { Keypair } from "stellar-sdk";
import { Label } from "@/components/ui/label";
```

Add form state inside the component (after existing state):

```tsx
  const [newName, setNewName] = useState("");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
```

- [ ] **Step 2: Add handleAddWallet function**

(`addWallet` is already destructured from `useWalletsV2()` in Task 2.)

```tsx
  async function handleAddWallet() {
    setAddError(null);
    if (!newName.trim()) { setAddError("Name required"); return; }
    if (!newFolderId) { setAddError("Select a folder"); return; }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(newSecretKey.trim());
    } catch {
      setAddError("Invalid secret key — must start with S and be 56 characters");
      return;
    }
    setAddLoading(true);
    addWallet(newFolderId, newName.trim(), keypair.publicKey(), newSecretKey.trim());
    // Immediately start fetching balance for the new wallet
    const result = await fetchXlmBalance(horizonUrl, keypair.publicKey());
    setBalances((prev) => ({ ...prev, [keypair.publicKey()]: result }));
    setNewName(""); setNewSecretKey(""); setNewFolderId(""); setAddError(null);
    setShowAddForm(false);
    setAddLoading(false);
  }
```

- [ ] **Step 3: Add form UI after the table**

Add after the table block, still inside the outer `<div className="space-y-4">`:

```tsx
      {/* Add wallet form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">Add Wallet</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input placeholder="Cold Storage" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Folder</Label>
              <Select value={newFolderId} onValueChange={setNewFolderId}>
                <SelectTrigger><SelectValue placeholder="Select folder…" /></SelectTrigger>
                <SelectContent>
                  {folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Secret Key</Label>
            <Input type="password" placeholder="S…" value={newSecretKey} onChange={(e) => setNewSecretKey(e.target.value)} />
          </div>
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setShowAddForm(false); setAddError(null); }}>Cancel</Button>
            <Button size="sm" onClick={handleAddWallet} disabled={addLoading}>
              {addLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save Wallet
            </Button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/wallet-balances/WalletBalancesPanel.tsx
git commit -m "feat(wallet-balances): add inline wallet form with keypair validation"
```

---

## Task 6: Update stats bar to use visibleWallets + update CLAUDE.md

**Files:**
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix stats to reflect visible (filtered) wallets**

Replace the stats calculations to use `visibleWallets` instead of all `wallets`:

```tsx
  const resolvedBalances = visibleWallets
    .map((w) => balances[w.publicKey])
    .filter((v): v is number => typeof v === "number");
  const totalXlm = resolvedBalances.reduce((sum, b) => sum + b, 0);
  const lowCount = resolvedBalances.filter((b) => b < LOW_BALANCE_THRESHOLD).length;
  const loadingCount = visibleWallets.filter((w) => balances[w.publicKey] === "loading").length;
```

Also update the **Wallets** stat card to show `visibleWallets.length`:

```tsx
          <p className="text-xl font-bold mt-0.5">{visibleWallets.length}</p>
```

- [ ] **Step 2: Update CLAUDE.md module inventory**

Change the `wallet-balances` row from `Planned` to `Working`:

```
| `wallet-balances` | Working — live XLM balance across all saved wallets; filter by folder or asset group; sort by balance; inline add wallet; copy/connect/investigate actions |
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
git add components/wallet-balances/WalletBalancesPanel.tsx CLAUDE.md
git commit -m "feat(wallet-balances): filter-aware stats + mark module working in CLAUDE.md"
```
